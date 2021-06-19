import * as k8s from '@kubernetes/client-node';
import { BuildParameters } from '..';
import * as core from '@actions/core';
import { KubeConfig, Log } from '@kubernetes/client-node';
import { Writable } from 'stream';
import { RemoteBuilderProviderInterface } from './remote-builder-provider-interface';
import RemoteBuilderSecret from './remote-builder-secret';
import { waitUntil } from 'async-wait-until';
import KubernetesStorage from './kubernetes-storage';
import RemoteBuilderEnvironmentVariable from './remote-builder-environment-variable';

const base64 = require('base-64');
class Kubernetes implements RemoteBuilderProviderInterface {
  private kubeConfig: KubeConfig;
  private kubeClient: k8s.CoreV1Api;
  private kubeClientBatch: k8s.BatchV1Api;
  private buildId: string = '';
  private buildParameters: BuildParameters;
  private pvcName: string = '';
  private secretName: string = '';
  private jobName: string = '';
  private namespace: string;
  private podName: string = '';
  private containerName: string = '';

  constructor(buildParameters: BuildParameters) {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const k8sBatchApi = kc.makeApiClient(k8s.BatchV1Api);
    core.info('Loaded default Kubernetes configuration for this environment');

    this.kubeConfig = kc;
    this.kubeClient = k8sApi;
    this.kubeClientBatch = k8sBatchApi;

    this.namespace = 'default';
    this.buildParameters = buildParameters;
  }
  async CleanupSharedBuildResources(
    // eslint-disable-next-line no-unused-vars
    buildUid: string,
    // eslint-disable-next-line no-unused-vars
    buildParameters: BuildParameters,
    // eslint-disable-next-line no-unused-vars
    branchName: string,
    // eslint-disable-next-line no-unused-vars
    defaultSecretsArray: { ParameterKey: string; EnvironmentVariable: string; ParameterValue: string }[],
  ) {
    await this.kubeClient.deleteNamespacedPersistentVolumeClaim(this.pvcName, this.namespace);
  }
  public async SetupSharedBuildResources(
    buildUid: string,
    buildParameters: BuildParameters,
    // eslint-disable-next-line no-unused-vars
    branchName: string,
    // eslint-disable-next-line no-unused-vars
    defaultSecretsArray: { ParameterKey: string; EnvironmentVariable: string; ParameterValue: string }[],
  ) {
    await KubernetesStorage.createPersistentVolumeClaim(buildParameters, this.pvcName, this.kubeClient, this.namespace);
  }

  async runBuildTask(
    buildId: string,
    image: string,
    commands: string[],
    mountdir: string,
    workingdir: string,
    environment: RemoteBuilderEnvironmentVariable[],
    secrets: RemoteBuilderSecret[],
  ): Promise<void> {
    try {
      this.setUniqueBuildId(buildId);
      // setup
      await this.createSecret(secrets);
      await KubernetesStorage.createPersistentVolumeClaim(
        this.buildParameters,
        this.pvcName,
        this.kubeClient,
        this.namespace,
      );

      //run
      const jobSpec = this.getJobSpec(commands, image, mountdir, workingdir, environment);
      core.info('Creating build job');
      await this.kubeClientBatch.createNamespacedJob(this.namespace, jobSpec);
      core.info('Job created');
      await KubernetesStorage.watchUntilPVCNotPending(this.kubeClient, this.pvcName, this.namespace);
      core.info('PVC Bound');
      this.setPodNameAndContainerName(await this.findPod());
      core.info('Watching pod until running');
      await this.watchUntilPodRunning();
      core.info('Pod running, streaming logs');
      await this.streamLogs();
      await this.cleanup();
    } catch (error) {
      core.info('Running job failed');
      core.error(JSON.stringify(error, undefined, 4));
      await this.cleanup();
      throw error;
    }
  }

  setUniqueBuildId(buildId: string) {
    const pvcName = `unity-builder-pvc-${buildId}`;
    const secretName = `build-credentials-${buildId}`;
    const jobName = `unity-builder-job-${buildId}`;

    this.buildId = buildId;
    this.pvcName = pvcName;
    this.secretName = secretName;
    this.jobName = jobName;
  }

  async createSecret(secrets: RemoteBuilderSecret[]) {
    const secret = new k8s.V1Secret();
    secret.apiVersion = 'v1';
    secret.kind = 'Secret';
    secret.type = 'Opaque';
    secret.metadata = {
      name: this.secretName,
    };
    secret.data = {};
    for (const buildSecret of secrets) {
      secret.data[buildSecret.EnvironmentVariable] = base64.encode(buildSecret.ParameterValue);
      secret.data[`${buildSecret.EnvironmentVariable}_NAME`] = base64.encode(buildSecret.ParameterKey);
    }
    try {
      await this.kubeClient.createNamespacedSecret(this.namespace, secret);
    } catch (error) {
      throw error;
    }
  }

  getJobSpec(
    command: string[],
    image: string,
    mountdir: string,
    workingDirectory: string,
    environment: RemoteBuilderEnvironmentVariable[],
  ) {
    environment.push(
      ...[
        {
          name: 'GITHUB_SHA',
          value: this.buildId,
        },
        {
          name: 'GITHUB_WORKSPACE',
          value: '/data/repo',
        },
        {
          name: 'PROJECT_PATH',
          value: this.buildParameters.projectPath,
        },
        {
          name: 'BUILD_PATH',
          value: this.buildParameters.buildPath,
        },
        {
          name: 'BUILD_FILE',
          value: this.buildParameters.buildFile,
        },
        {
          name: 'BUILD_NAME',
          value: this.buildParameters.buildName,
        },
        {
          name: 'BUILD_METHOD',
          value: this.buildParameters.buildMethod,
        },
        {
          name: 'CUSTOM_PARAMETERS',
          value: this.buildParameters.customParameters,
        },
        {
          name: 'CHOWN_FILES_TO',
          value: this.buildParameters.chownFilesTo,
        },
        {
          name: 'BUILD_TARGET',
          value: this.buildParameters.platform,
        },
        {
          name: 'ANDROID_VERSION_CODE',
          value: this.buildParameters.androidVersionCode.toString(),
        },
        {
          name: 'ANDROID_KEYSTORE_NAME',
          value: this.buildParameters.androidKeystoreName,
        },
        {
          name: 'ANDROID_KEYALIAS_NAME',
          value: this.buildParameters.androidKeyaliasName,
        },
      ],
    );
    const job = new k8s.V1Job();
    job.apiVersion = 'batch/v1';
    job.kind = 'Job';
    job.metadata = {
      name: this.jobName,
      labels: {
        app: 'unity-builder',
      },
    };
    job.spec = {
      backoffLimit: 1,
      template: {
        spec: {
          volumes: [
            {
              name: 'build-mount',
              persistentVolumeClaim: {
                claimName: this.pvcName,
              },
            },
            {
              name: 'credentials',
              secret: {
                secretName: this.secretName,
              },
            },
          ],
          containers: [
            {
              name: 'main',
              image,
              args: command,

              workingDir: `/${workingDirectory}`,
              resources: {
                requests: {
                  memory: this.buildParameters.remoteBuildMemory,
                  cpu: this.buildParameters.remoteBuildCpu,
                },
              },
              env: environment,
              volumeMounts: [
                {
                  name: 'build-mount',
                  mountPath: `/${mountdir}`,
                },
                {
                  name: 'credentials',
                  mountPath: '/credentials',
                  readOnly: true,
                },
              ],
              lifecycle: {
                preStop: {
                  exec: {
                    command: [
                      'bin/bash',
                      '-c',
                      `cd /data/builder/action/steps;
                      chmod +x /return_license.sh;
                      /return_license.sh;`,
                    ],
                  },
                },
              },
            },
          ],
          restartPolicy: 'Never',
        },
      },
    };
    return job;
  }

  async findPod() {
    const pod = (await this.kubeClient.listNamespacedPod(this.namespace)).body.items.find(
      (x) => x.metadata?.labels?.['job-name'] === this.jobName,
    );
    if (pod === undefined) {
      throw new Error("pod with job-name label doesn't exist");
    }
    return pod;
  }

  async watchUntilPodRunning() {
    let success: boolean = false;
    core.info(`Watching ${this.podName} ${this.namespace}`);
    await waitUntil(
      async () => {
        const phase = (await this.kubeClient.readNamespacedPodStatus(this.podName, this.namespace))?.body.status?.phase;
        success = phase === 'Running';
        if (success || phase !== 'Pending') return true;
        return false;
      },
      {
        timeout: 500000,
        intervalBetweenAttempts: 15000,
      },
    );
    return success;
  }

  setPodNameAndContainerName(pod: k8s.V1Pod) {
    this.podName = pod.metadata?.name || '';
    this.containerName = pod.status?.containerStatuses?.[0].name || '';
  }

  async streamLogs() {
    core.info(`Streaming logs from pod: ${this.podName} container: ${this.containerName} namespace: ${this.namespace}`);
    const stream = new Writable();
    let didStreamAnyLogs: boolean = false;
    stream._write = (chunk, encoding, next) => {
      didStreamAnyLogs = true;
      core.info(chunk.toString());
      next();
    };
    const logOptions = {
      follow: true,
      pretty: true,
      previous: false,
    };
    try {
      const resultError = await new Promise(async (resolve) =>
        new Log(this.kubeConfig).log(this.namespace, this.podName, this.containerName, stream, resolve, logOptions),
      );
      if (resultError) {
        throw resultError;
      }
      if (!didStreamAnyLogs) {
        throw new Error(
          JSON.stringify(
            {
              message: 'Failed to stream any logs, listing namespace events, check for an error with the container',
              events: (await this.kubeClient.listNamespacedEvent(this.namespace)).body.items
                .filter((x) => {
                  return x.involvedObject.name === this.podName || x.involvedObject.name === this.jobName;
                })
                .map((x) => {
                  return {
                    type: x.involvedObject.kind,
                    name: x.involvedObject.name,
                    message: x.message,
                  };
                }),
            },
            undefined,
            4,
          ),
        );
      }
    } catch (error) {
      throw error;
    }
    core.info('end of log stream');
  }

  async cleanup() {
    core.info('cleaning up');
    try {
      await this.kubeClientBatch.deleteNamespacedJob(this.jobName, this.namespace);
      await this.kubeClient.deleteNamespacedSecret(this.secretName, this.namespace);
    } catch (error) {
      core.info('Failed to cleanup, error:');
      core.error(JSON.stringify(error, undefined, 4));
      core.info('Abandoning cleanup, build error:');
    }
  }
}
export default Kubernetes;
