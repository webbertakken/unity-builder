import * as k8s from '@kubernetes/client-node';
import { BuildParameters } from '..';
import * as core from '@actions/core';
import { RemoteBuilderProviderInterface } from './remote-builder-provider-interface';
import RemoteBuilderSecret from './remote-builder-secret';
import KubernetesStorage from './kubernetes-storage';
import RemoteBuilderEnvironmentVariable from './remote-builder-environment-variable';
import KubernetesLogging from './kubernetes-logging';
import KubernetesSecret from './kubernetes-secret';
import KubernetesUtilities from './kubernetes-utils';
import waitUntil from 'async-wait-until';
import KubernetesJobSpecFactory from './kubernetes-job-spec-factory';
import KubernetesCleanupCronJob from './kubernetes-cleanup-cronjob';

class Kubernetes implements RemoteBuilderProviderInterface {
  private kubeConfig: k8s.KubeConfig;
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
  private cleanupCronJobName: string = '';
  private kubeClientBatchBeta: k8s.BatchV1beta1Api;

  constructor(buildParameters: BuildParameters) {
    this.kubeConfig = new k8s.KubeConfig();
    this.kubeConfig.loadFromDefault();
    this.kubeClient = this.kubeConfig.makeApiClient(k8s.CoreV1Api);
    this.kubeClientBatch = this.kubeConfig.makeApiClient(k8s.BatchV1Api);
    this.kubeClientBatchBeta = this.kubeConfig.makeApiClient(k8s.BatchV1beta1Api);
    core.info('Loaded default Kubernetes configuration for this environment');

    this.namespace = 'default';
    this.buildParameters = buildParameters;
  }
  public async setupSharedBuildResources(
    buildUid: string,
    buildParameters: BuildParameters,
    // eslint-disable-next-line no-unused-vars
    branchName: string,
    // eslint-disable-next-line no-unused-vars
    defaultSecretsArray: { ParameterKey: string; EnvironmentVariable: string; ParameterValue: string }[],
  ) {
    try {
      this.pvcName = `unity-builder-pvc-${buildUid}`;
      this.cleanupCronJobName = `unity-builder-cronjob-${buildUid}`;
      await KubernetesStorage.createPersistentVolumeClaim(
        buildParameters,
        this.pvcName,
        this.kubeClient,
        this.namespace,
      );
      await KubernetesCleanupCronJob.createCleanupCronJob(
        this.kubeClientBatchBeta,
        this.cleanupCronJobName,
        this.namespace,
      );
    } catch (error) {
      throw error;
    }
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
      // setup
      this.buildId = buildId;
      this.secretName = `build-credentials-${buildId}`;
      this.jobName = `unity-builder-job-${buildId}`;
      await KubernetesSecret.createSecret(secrets, this.secretName, this.namespace, this.kubeClient);
      const jobSpec = KubernetesJobSpecFactory.getJobSpec(
        commands,
        image,
        mountdir,
        workingdir,
        environment,
        this.buildId,
        this.buildParameters,
        this.secretName,
        this.pvcName,
        this.jobName,
        k8s,
      );

      //run
      core.info('Creating build job');
      await this.kubeClientBatch.createNamespacedJob(this.namespace, jobSpec);
      core.info('Job created');
      await KubernetesStorage.watchUntilPVCNotPending(this.kubeClient, this.pvcName, this.namespace);
      core.info('PVC Bound');
      this.setPodNameAndContainerName(
        await KubernetesUtilities.findPodFromJob(this.kubeClient, this.jobName, this.namespace),
      );
      core.info('Watching pod until running');
      await KubernetesUtilities.watchUntilPodRunning(this.kubeClient, this.podName, this.namespace);
      core.info('Pod running, streaming logs');
      await KubernetesLogging.streamLogs(
        this.kubeConfig,
        this.kubeClient,
        this.jobName,
        this.podName,
        this.containerName,
        this.namespace,
        core.info,
      );
      await this.cleanupTaskResources();
    } catch (error) {
      core.info('Running job failed');
      core.error(JSON.stringify(error, undefined, 4));
      await this.cleanupTaskResources();
      throw error;
    }
  }

  setPodNameAndContainerName(pod: k8s.V1Pod) {
    this.podName = pod.metadata?.name || '';
    this.containerName = pod.status?.containerStatuses?.[0].name || '';
  }

  async cleanupTaskResources() {
    core.info('cleaning up');
    try {
      await this.kubeClientBatch.deleteNamespacedJob(this.jobName, this.namespace);
      await this.kubeClient.deleteNamespacedSecret(this.secretName, this.namespace);
    } catch (error) {
      core.info('Failed to cleanup, error:');
      core.error(JSON.stringify(error, undefined, 4));
      core.info('Abandoning cleanup, build error:');
      throw error;
    }
    try {
      await waitUntil(
        async () => (await this.kubeClientBatch.readNamespacedJob(this.jobName, this.namespace)).body === null,
        {
          timeout: 500000,
          intervalBetweenAttempts: 15000,
        },
      );
    } catch {
      core.info('failed to read the state of the job while cleaning up?');
    }
  }

  async cleanupSharedBuildResources(
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
    await KubernetesCleanupCronJob.cleanup(this.kubeClientBatchBeta, this.cleanupCronJobName, this.namespace);
  }
}
export default Kubernetes;
