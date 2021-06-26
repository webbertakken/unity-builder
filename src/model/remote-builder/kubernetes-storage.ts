import waitUntil from 'async-wait-until';
import * as core from '@actions/core';
import * as k8s from '@kubernetes/client-node';
import BuildParameters from '../build-parameters';

class KubernetesStorage {
  public static async getPVCPhase(kubeClient: k8s.CoreV1Api, name: string, namespace: string) {
    return (await kubeClient.readNamespacedPersistentVolumeClaim(name, namespace)).body.status?.phase;
  }
  public static async watchUntilPVCNotPending(kubeClient: k8s.CoreV1Api, name: string, namespace: string) {
    core.info(`watch Until PVC Not Pending ${name} ${namespace}`);
    await waitUntil(async () => (await this.getPVCPhase(kubeClient, name, namespace)) !== 'Pending', {
      timeout: 500000,
      intervalBetweenAttempts: 15000,
    });
  }

  public static async createPersistentVolumeClaim(
    buildParameters: BuildParameters,
    pvcName: string,
    kubeClient: k8s.CoreV1Api,
    namespace: string,
  ) {
    if (buildParameters.kubeVolume) {
      core.info(buildParameters.kubeVolume);
      pvcName = buildParameters.kubeVolume;
      return;
    }
    const pvc = new k8s.V1PersistentVolumeClaim();
    pvc.apiVersion = 'v1';
    pvc.kind = 'PersistentVolumeClaim';
    pvc.metadata = {
      name: pvcName,
    };
    pvc.spec = {
      accessModes: ['ReadWriteOnce'],
      volumeMode: 'Filesystem',
      resources: {
        requests: {
          storage: buildParameters.kubeVolumeSize,
        },
      },
    };
    const result = await kubeClient.createNamespacedPersistentVolumeClaim(namespace, pvc);
    core.info(`Persistent Volume Claim ${result.body.metadata?.name} ${pvcName} created`);
    core.setOutput('volume', pvcName);
  }
}

export default KubernetesStorage;
