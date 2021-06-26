import BuildParameters from '../build-parameters';
import RemoteBuilderEnvironmentVariable from './remote-builder-environment-variable';

class KubernetesJobSpecFactory {
  static getJobSpec(
    command: string[],
    image: string,
    mountdir: string,
    workingDirectory: string,
    environment: RemoteBuilderEnvironmentVariable[],
    buildId: string,
    buildParameters: BuildParameters,
    secretName,
    pvcName,
    jobName,
    k8s,
  ) {
    environment.push(
      ...[
        {
          name: 'GITHUB_SHA',
          value: buildId,
        },
        {
          name: 'GITHUB_WORKSPACE',
          value: '/data/repo',
        },
        {
          name: 'PROJECT_PATH',
          value: buildParameters.projectPath,
        },
        {
          name: 'BUILD_PATH',
          value: buildParameters.buildPath,
        },
        {
          name: 'BUILD_FILE',
          value: buildParameters.buildFile,
        },
        {
          name: 'BUILD_NAME',
          value: buildParameters.buildName,
        },
        {
          name: 'BUILD_METHOD',
          value: buildParameters.buildMethod,
        },
        {
          name: 'CUSTOM_PARAMETERS',
          value: buildParameters.customParameters,
        },
        {
          name: 'CHOWN_FILES_TO',
          value: buildParameters.chownFilesTo,
        },
        {
          name: 'BUILD_TARGET',
          value: buildParameters.platform,
        },
        {
          name: 'ANDROID_VERSION_CODE',
          value: buildParameters.androidVersionCode.toString(),
        },
        {
          name: 'ANDROID_KEYSTORE_NAME',
          value: buildParameters.androidKeystoreName,
        },
        {
          name: 'ANDROID_KEYALIAS_NAME',
          value: buildParameters.androidKeyaliasName,
        },
      ],
    );
    const job = new k8s.V1Job();
    job.apiVersion = 'batch/v1';
    job.kind = 'Job';
    job.metadata = {
      name: jobName,
      labels: {
        app: 'unity-builder',
        buildId,
      },
    };
    job.spec = {
      backoffLimit: 0,
      template: {
        spec: {
          volumes: [
            {
              name: 'build-mount',
              persistentVolumeClaim: {
                claimName: pvcName,
              },
            },
            {
              name: 'credentials',
              secret: {
                secretName,
              },
            },
          ],
          containers: [
            {
              name: 'main',
              image,
              command: ['/bin/sh'],
              args: ['-c', ...command],

              workingDir: `/${workingDirectory}`,
              resources: {
                requests: {
                  memory: buildParameters.remoteBuildMemory,
                  cpu: buildParameters.remoteBuildCpu,
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
}
export default KubernetesJobSpecFactory;
