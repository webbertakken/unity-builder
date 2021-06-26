import { BatchV1beta1Api, V1beta1CronJob } from '@kubernetes/client-node';
import * as core from '@actions/core';
class KubernetesCleanupCronJob {
  static async cleanup(api: BatchV1beta1Api, name: string, namespace: string) {
    await api.deleteNamespacedCronJob('name', namespace);
  }
  static async createCleanupCronJob(kubeClientBatch: BatchV1beta1Api, name: string, namespace: string) {
    try {
      const batchJob = new V1beta1CronJob();
      batchJob.kind = 'CronJob';
      batchJob.metadata = {
        name,
        labels: {
          app: 'unity-builder',
        },
      };
      const spec = {
        restartPolicy: 'Never',
        containers: [
          {
            name: 'main',
            image: 'bitnami/kubectl',
            imagePullPolicy: '',
            command: ['/bin/sh'],
            args: [
              '-c',
              `
              echo "delete the kubernetes resources"
              kubectl get pods
              `,
            ],
          },
        ],
      };
      batchJob.spec = {
        schedule: `0 ${new Date().getUTCHours() + 3} * * *`,
        jobTemplate: {
          spec: {
            template: { spec },
          },
        },
      };

      core.info('creating cron job');
      await kubeClientBatch.createNamespacedCronJob(namespace, batchJob);
      core.info('created cron job');
    } catch (error) {
      throw error;
    }
  }
}
export default KubernetesCleanupCronJob;
