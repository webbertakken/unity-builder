import * as AWS from 'aws-sdk';
import RemoteBuilderEnvironmentVariable from './remote-builder-environment-variable';
import * as core from '@actions/core';
import RemoteBuilderTaskDef from './remote-builder-task-def';
import * as zlib from 'zlib';

class AWSBuildRunner {
  static async runTask(
    taskDef: RemoteBuilderTaskDef,
    ECS: AWS.ECS,
    CF: AWS.CloudFormation,
    environment: RemoteBuilderEnvironmentVariable[],
    buildUid: string,
    commands: string[],
  ) {
    const cluster = taskDef.baseResources?.find((x) => x.LogicalResourceId === 'ECSCluster')?.PhysicalResourceId || '';
    const taskDefinition =
      taskDef.taskDefResources?.find((x) => x.LogicalResourceId === 'TaskDefinition')?.PhysicalResourceId || '';
    const SubnetOne =
      taskDef.baseResources?.find((x) => x.LogicalResourceId === 'PublicSubnetOne')?.PhysicalResourceId || '';
    const SubnetTwo =
      taskDef.baseResources?.find((x) => x.LogicalResourceId === 'PublicSubnetTwo')?.PhysicalResourceId || '';
    const ContainerSecurityGroup =
      taskDef.baseResources?.find((x) => x.LogicalResourceId === 'ContainerSecurityGroup')?.PhysicalResourceId || '';
    const streamName =
      taskDef.taskDefResources?.find((x) => x.LogicalResourceId === 'KinesisStream')?.PhysicalResourceId || '';

    const task = await ECS.runTask({
      cluster,
      taskDefinition,
      platformVersion: '1.4.0',
      overrides: {
        containerOverrides: [
          {
            name: taskDef.taskDefStackName,
            environment: [...environment, { name: 'BUILDID', value: buildUid }],
            command: ['-c', ...commands],
          },
        ],
      },
      launchType: 'FARGATE',
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: [SubnetOne, SubnetTwo],
          assignPublicIp: 'ENABLED',
          securityGroups: [ContainerSecurityGroup],
        },
      },
    }).promise();

    core.info('Task is starting on worker cluster');
    const taskArn = task.tasks?.[0].taskArn || '';

    try {
      await ECS.waitFor('tasksRunning', { tasks: [taskArn], cluster }).promise();
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const describeTasks = await ECS.describeTasks({
        tasks: [taskArn],
        cluster,
      }).promise();
      core.info(`Task has ended ${describeTasks.tasks?.[0].containers?.[0].lastStatus}`);
      core.setFailed(error);
      core.error(error);
    }
    core.info(`Task is running on worker cluster`);
    await this.streamLogsUntilTaskStops(ECS, CF, taskDef, cluster, taskArn, streamName);
    await ECS.waitFor('tasksStopped', { cluster, tasks: [taskArn] }).promise();
    const exitCode = (
      await ECS.describeTasks({
        tasks: [taskArn],
        cluster,
      }).promise()
    ).tasks?.[0].containers?.[0].exitCode;
    if (exitCode !== 0) {
      core.error(`job failed with exit code ${exitCode}`);
      throw new Error(`job failed with exit code ${exitCode}`);
    } else {
      core.info(`Task has finished successfully`);
    }
  }

  static async streamLogsUntilTaskStops(
    ECS: AWS.ECS,
    CF: AWS.CloudFormation,
    taskDef: RemoteBuilderTaskDef,
    clusterName: string,
    taskArn: string,
    kinesisStreamName: string,
  ) {
    // watching logs
    const kinesis = new AWS.Kinesis();

    const getTaskData = async () => {
      const tasks = await ECS.describeTasks({
        cluster: clusterName,
        tasks: [taskArn],
      }).promise();
      return tasks.tasks?.[0];
    };

    const stream = await kinesis
      .describeStream({
        StreamName: kinesisStreamName,
      })
      .promise();

    let iterator =
      (
        await kinesis
          .getShardIterator({
            ShardIteratorType: 'TRIM_HORIZON',
            StreamName: stream.StreamDescription.StreamName,
            ShardId: stream.StreamDescription.Shards[0].ShardId,
          })
          .promise()
      ).ShardIterator || '';

    await CF.waitFor('stackCreateComplete', { StackName: taskDef.taskDefStackNameTTL }).promise();

    core.info(`Task status is ${(await getTaskData())?.lastStatus}`);

    const logBaseUrl = `https://${AWS.config.region}.console.aws.amazon.com/cloudwatch/home?region=${AWS.config.region}#logsV2:log-groups/log-group/${taskDef.taskDefStackName}`;
    core.info(`You can also see the logs at AWS Cloud Watch: ${logBaseUrl}`);

    let readingLogs = true;
    let timestamp: number = 0;
    while (readingLogs) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const taskData = await getTaskData();
      if (taskData?.lastStatus !== 'RUNNING') {
        if (timestamp === 0) {
          core.info('Task stopped, streaming end of logs');
          timestamp = Date.now();
        }
        if (timestamp !== 0 && Date.now() - timestamp < 30000) {
          core.info('Task status is not RUNNING for 30 seconds, last query for logs');
          readingLogs = false;
        }
      }
      const records = await kinesis
        .getRecords({
          ShardIterator: iterator,
        })
        .promise();
      iterator = records.NextShardIterator || '';
      if (records.Records.length > 0 && iterator) {
        for (let index = 0; index < records.Records.length; index++) {
          const json = JSON.parse(
            zlib.gunzipSync(Buffer.from(records.Records[index].Data as string, 'base64')).toString('utf8'),
          );
          if (json.messageType === 'DATA_MESSAGE') {
            for (let logEventsIndex = 0; logEventsIndex < json.logEvents.length; logEventsIndex++) {
              if (json.logEvents[logEventsIndex].message.includes(taskDef.logid)) {
                core.info('End of task logs');
                readingLogs = false;
              } else {
                core.info(json.logEvents[logEventsIndex].message);
              }
            }
          }
        }
      }
    }
  }
}
export default AWSBuildRunner;
