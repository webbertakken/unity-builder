import BuildParameters from '../build-parameters';
import RemoteBuilderEnvironmentVariable from './remote-builder-environment-variable';
import RemoteBuilderSecret from './remote-builder-secret';

export interface RemoteBuilderProviderInterface {
  cleanupSharedBuildResources(
    // eslint-disable-next-line no-unused-vars
    buildUid: string,
    // eslint-disable-next-line no-unused-vars
    buildParameters: BuildParameters,
    // eslint-disable-next-line no-unused-vars
    branchName: string,
    // eslint-disable-next-line no-unused-vars
    defaultSecretsArray: { ParameterKey: string; EnvironmentVariable: string; ParameterValue: string }[],
  );
  setupSharedBuildResources(
    // eslint-disable-next-line no-unused-vars
    buildUid: string,
    // eslint-disable-next-line no-unused-vars
    buildParameters: BuildParameters,
    // eslint-disable-next-line no-unused-vars
    branchName: string,
    // eslint-disable-next-line no-unused-vars
    defaultSecretsArray: { ParameterKey: string; EnvironmentVariable: string; ParameterValue: string }[],
  );
  runBuildTask(
    // eslint-disable-next-line no-unused-vars
    buildId: string,
    // eslint-disable-next-line no-unused-vars
    image: string,
    // eslint-disable-next-line no-unused-vars
    commands: string[],
    // eslint-disable-next-line no-unused-vars
    mountdir: string,
    // eslint-disable-next-line no-unused-vars
    workingdir: string,
    // eslint-disable-next-line no-unused-vars
    environment: RemoteBuilderEnvironmentVariable[],
    // eslint-disable-next-line no-unused-vars
    secrets: RemoteBuilderSecret[],
  ): Promise<void>;
}
