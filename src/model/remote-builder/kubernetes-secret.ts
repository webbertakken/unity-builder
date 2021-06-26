import { CoreV1Api } from '@kubernetes/client-node';
import RemoteBuilderSecret from './remote-builder-secret';
import * as k8s from '@kubernetes/client-node';
const base64 = require('base-64');

class KubernetesSecret {
  static async createSecret(
    secrets: RemoteBuilderSecret[],
    secretName: string,
    namespace: string,
    kubeClient: CoreV1Api,
  ) {
    const secret = new k8s.V1Secret();
    secret.apiVersion = 'v1';
    secret.kind = 'Secret';
    secret.type = 'Opaque';
    secret.metadata = {
      name: secretName,
    };
    secret.data = {};
    for (const buildSecret of secrets) {
      secret.data[buildSecret.EnvironmentVariable] = base64.encode(buildSecret.ParameterValue);
      secret.data[`${buildSecret.EnvironmentVariable}_NAME`] = base64.encode(buildSecret.ParameterKey);
    }
    try {
      await kubeClient.createNamespacedSecret(namespace, secret);
    } catch (error) {
      throw error;
    }
  }
}

export default KubernetesSecret;
