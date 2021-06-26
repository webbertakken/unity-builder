import Platform from './platform';

const core = require('@actions/core');

/**
 * Input variables specified in workflows using "with" prop.
 *
 * Note that input is always passed as a string, even booleans.
 */
class Input {
  static get unityVersion() {
    return core.getInput('unityVersion') || 'auto';
  }

  static get customImage() {
    return core.getInput('customImage');
  }

  static get targetPlatform() {
    return core.getInput('targetPlatform') || Platform.default;
  }

  static get projectPath() {
    const rawProjectPath = core.getInput('projectPath') || '.';
    return rawProjectPath.replace(/\/$/, '');
  }

  static get buildName() {
    return core.getInput('buildName') || this.targetPlatform;
  }

  static get buildsPath() {
    return core.getInput('buildsPath') || 'build';
  }

  static get buildMethod() {
    return core.getInput('buildMethod'); // processed in docker file
  }

  static get versioningStrategy() {
    return core.getInput('versioning') || 'Semantic';
  }

  static get specifiedVersion() {
    return core.getInput('version') || '';
  }

  static get androidVersionCode() {
    return core.getInput('androidVersionCode');
  }

  static get androidAppBundle() {
    const input = core.getInput('androidAppBundle') || false;

    return input === 'true';
  }

  static get androidKeystoreName() {
    return core.getInput('androidKeystoreName') || '';
  }

  static get androidKeystoreBase64() {
    return core.getInput('androidKeystoreBase64') || '';
  }

  static get androidKeystorePass() {
    return core.getInput('androidKeystorePass') || '';
  }

  static get androidKeyaliasName() {
    return core.getInput('androidKeyaliasName') || '';
  }

  static get androidKeyaliasPass() {
    return core.getInput('androidKeyaliasPass') || '';
  }

  static get allowDirtyBuild() {
    const input = core.getInput('allowDirtyBuild') || false;

    return input === 'true';
  }

  static get customParameters() {
    return core.getInput('customParameters') || '';
  }

  static get sshAgent() {
    return core.getInput('sshAgent') || '';
  }

  static get chownFilesTo() {
    return core.getInput('chownFilesTo') || '';
  }

  static get remoteBuildCluster() {
    return core.getInput('remoteBuildCluster') || '';
  }

  static get awsStackName() {
    return core.getInput('awsStackName') || '';
  }

  static get kubeConfig() {
    return core.getInput('kubeConfig') || '';
  }

  static get githubToken() {
    return core.getInput('githubToken') || '';
  }

  static get remoteBuildMemory() {
    return core.getInput('remoteBuildMemory') || '750M';
  }

  static get remoteBuildCpu() {
    return core.getInput('remoteBuildCpu') || '1.0';
  }

  static get kubeVolumeSize() {
    return core.getInput('kubeVolumeSize') || '5Gi';
  }

  static get kubeVolume() {
    return core.getInput('kubeVolume') || '';
  }
}

export default Input;
