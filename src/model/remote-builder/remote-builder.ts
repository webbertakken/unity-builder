import AWSBuildPlatform from './aws-build-platform';
import * as core from '@actions/core';
import { BuildParameters } from '..';
import RemoteBuilderNamespace from './remote-builder-namespace';
import RemoteBuilderSecret from './remote-builder-secret';
import { RemoteBuilderProviderInterface } from './remote-builder-provider-interface';
import Kubernetes from './kubernetes-build-platform';
const repositoryFolder = 'repo';
const buildVolumeFolder = 'data';
const cacheFolder = 'cache';

class RemoteBuilder {
  static SteamDeploy: boolean = false;
  static RemoteBuilderProviderPlatform: RemoteBuilderProviderInterface;
  static async build(buildParameters: BuildParameters, baseImage) {
    const runNumber = process.env.GITHUB_RUN_NUMBER;
    if (!runNumber || runNumber === '') {
      throw new Error('no run number found, exiting');
    }
    const buildUid = RemoteBuilderNamespace.generateBuildName(runNumber, buildParameters.platform);
    const defaultBranchName =
      process.env.GITHUB_REF?.split('/')
        .filter((x) => {
          x = x[0].toUpperCase() + x.slice(1);
          return x;
        })
        .join('') || '';
    const branchName =
      process.env.REMOTE_BUILDER_CACHE !== undefined ? process.env.REMOTE_BUILDER_CACHE : defaultBranchName;
    this.SteamDeploy = process.env.STEAM_DEPLOY !== undefined || false;
    const token: string = buildParameters.githubToken;
    const defaultSecretsArray = [
      {
        ParameterKey: 'GithubToken',
        EnvironmentVariable: 'GITHUB_TOKEN',
        ParameterValue: token,
      },
    ];
    try {
      switch (buildParameters.remoteBuildCluster) {
        case 'aws':
          core.info('Building with AWS');
          this.RemoteBuilderProviderPlatform = new AWSBuildPlatform(buildParameters);
          break;
        default:
        case 'k8s':
          core.info('Building with Kubernetes');
          this.RemoteBuilderProviderPlatform = new Kubernetes(buildParameters);
          break;
      }
      await this.RemoteBuilderProviderPlatform.setupSharedBuildResources(
        buildUid,
        buildParameters,
        branchName,
        defaultSecretsArray,
      );
      await RemoteBuilder.SetupStep(`setup${buildUid}`, buildParameters, branchName, defaultSecretsArray);
      await RemoteBuilder.BuildStep(`build${buildUid}`, buildParameters, baseImage, defaultSecretsArray);
      await RemoteBuilder.CompressionStep(`compress${buildUid}`, buildParameters, branchName, defaultSecretsArray);
      await RemoteBuilder.UploadArtifacts(`upload${buildUid}`, buildParameters, branchName, defaultSecretsArray);
      if (this.SteamDeploy) {
        await RemoteBuilder.DeployToSteam(buildUid, buildParameters, defaultSecretsArray);
      }
      await this.RemoteBuilderProviderPlatform.cleanupSharedBuildResources(
        buildUid,
        buildParameters,
        branchName,
        defaultSecretsArray,
      );
    } catch (error) {
      core.error(JSON.stringify(error, undefined, 4));
      core.setFailed('Remote Builder failed');
      await this.RemoteBuilderProviderPlatform.cleanupSharedBuildResources(
        buildUid,
        buildParameters,
        branchName,
        defaultSecretsArray,
      );
      throw error;
    }
  }

  private static async SetupStep(
    buildUid: string,
    buildParameters: BuildParameters,
    branchName: string | undefined,
    defaultSecretsArray: RemoteBuilderSecret[],
  ) {
    core.info('Starting step 1/4 clone and restore cache)');
    await this.RemoteBuilderProviderPlatform.runBuildTask(
      buildUid,
      'alpine/git',
      [
        `apk update;
          apk add unzip;
          apk add git-lfs;
          apk add jq;

          # Get source repo for project to be built and game-ci repo for utilties

          git clone https://${buildParameters.githubToken}@github.com/${
          process.env.GITHUB_REPOSITORY
        }.git ${buildUid}/${repositoryFolder}
          cd ${buildUid}/${repositoryFolder}/
          git lfs ls-files -l | cut -d' ' -f1 | sort > .assets-id
          cd ../../
          git clone https://${buildParameters.githubToken}@github.com/game-ci/unity-builder.git ${buildUid}/builder
          git clone https://${buildParameters.githubToken}@github.com/game-ci/steam-deploy.git ${buildUid}/steam
          cd /${buildVolumeFolder}/${buildUid}/${repositoryFolder}/
          git checkout $GITHUB_SHA
          cd /${buildVolumeFolder}/
          # Look for usable cache
          if [ ! -d ${cacheFolder} ]; then
            mkdir ${cacheFolder}
          fi
          cd ${cacheFolder}
          if [ ! -d "${branchName}" ]; then
            mkdir "${branchName}"
          fi
          cd "${branchName}"
          echo ''
          echo "Cached Libraries for ${branchName} from previous builds:"
          ls
          echo ''
          ls "/${buildVolumeFolder}/${buildUid}/${repositoryFolder}/${buildParameters.projectPath}"
          libDir="/${buildVolumeFolder}/${buildUid}/${repositoryFolder}/${buildParameters.projectPath}/Library"
          if [ -d "$libDir" ]; then
            rm -r "$libDir"
            echo "Setup .gitignore to ignore Library folder and remove it from builds"
          fi
          echo 'Checking cache'
          # Restore cache
          latest=$(ls -t | head -1)
          if [ ! -z "$latest" ]; then
            echo "Library cache exists from build $latest from ${branchName}"
            echo 'Creating empty Library folder for cache'
            mkdir $libDir
            unzip -q $latest -d $libDir
            # purge cache
            ${process.env.PURGE_REMOTE_BUILDER_CACHE === undefined ? '#' : ''} rm -r $libDir
          else
            echo 'Cache does not exist'
          fi
          # Print out important directories
          echo ''
          echo 'Repo:'
          ls /${buildVolumeFolder}/${buildUid}/${repositoryFolder}/
          echo ''
          echo 'Project:'
          ls /${buildVolumeFolder}/${buildUid}/${repositoryFolder}/${buildParameters.projectPath}
          echo ''
          echo 'Library:'
          ls /${buildVolumeFolder}/${buildUid}/${repositoryFolder}/${buildParameters.projectPath}/Library/
          echo ''
      `,
      ],
      `/${buildVolumeFolder}`,
      `/${buildVolumeFolder}/`,
      [
        {
          name: 'GITHUB_SHA',
          value: process.env.GITHUB_SHA || '',
        },
      ],
      defaultSecretsArray,
    );
  }

  private static async BuildStep(
    buildUid: string,
    buildParameters: BuildParameters,
    baseImage: any,
    defaultSecretsArray: RemoteBuilderSecret[],
  ) {
    const buildSecrets = new Array();

    buildSecrets.push(...defaultSecretsArray);

    if (process.env.UNITY_LICENSE)
      buildSecrets.push({
        ParameterKey: 'UnityLicense',
        EnvironmentVariable: 'UNITY_LICENSE',
        ParameterValue: process.env.UNITY_LICENSE,
      });

    if (process.env.UNITY_EMAIL)
      buildSecrets.push({
        ParameterKey: 'UnityEmail',
        EnvironmentVariable: 'UNITY_EMAIL',
        ParameterValue: process.env.UNITY_EMAIL,
      });

    if (process.env.UNITY_PASSWORD)
      buildSecrets.push({
        ParameterKey: 'UnityPassword',
        EnvironmentVariable: 'UNITY_PASSWORD',
        ParameterValue: process.env.UNITY_PASSWORD,
      });

    if (process.env.UNITY_SERIAL)
      buildSecrets.push({
        ParameterKey: 'UnitySerial',
        EnvironmentVariable: 'UNITY_SERIAL',
        ParameterValue: process.env.UNITY_SERIAL,
      });

    if (buildParameters.androidKeystoreBase64)
      buildSecrets.push({
        ParameterKey: 'AndroidKeystoreBase64',
        EnvironmentVariable: 'ANDROID_KEYSTORE_BASE64',
        ParameterValue: buildParameters.androidKeystoreBase64,
      });

    if (buildParameters.androidKeystorePass)
      buildSecrets.push({
        ParameterKey: 'AndroidKeystorePass',
        EnvironmentVariable: 'ANDROID_KEYSTORE_PASS',
        ParameterValue: buildParameters.androidKeystorePass,
      });

    if (buildParameters.androidKeyaliasPass)
      buildSecrets.push({
        ParameterKey: 'AndroidKeyAliasPass',
        EnvironmentVariable: 'AWS_ACCESS_KEY_ALIAS_PASS',
        ParameterValue: buildParameters.androidKeyaliasPass,
      });
    core.info('Starting part 2/4 (build unity project)');
    await this.RemoteBuilderProviderPlatform.runBuildTask(
      buildUid,
      baseImage.toString(),
      [
        `
            cp -r /${buildVolumeFolder}/${buildUid}/builder/dist/default-build-script/ /UnityBuilderAction;
            cp -r /${buildVolumeFolder}/${buildUid}/builder/dist/entrypoint.sh /entrypoint.sh;
            cp -r /${buildVolumeFolder}/${buildUid}/builder/dist/steps/ /steps;
            chmod -R +x /entrypoint.sh;
            chmod -R +x /steps;
            /entrypoint.sh;
          `,
      ],
      `/${buildVolumeFolder}`,
      `/${buildVolumeFolder}/${buildUid}/${repositoryFolder}/`,
      [
        {
          name: 'ContainerMemory',
          value: buildParameters.remoteBuildMemory,
        },
        {
          name: 'ContainerCpu',
          value: buildParameters.remoteBuildCpu,
        },
        {
          name: 'GITHUB_WORKSPACE',
          value: `/${buildVolumeFolder}/${buildUid}/${repositoryFolder}/`,
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
      buildSecrets,
    );
  }

  private static async CompressionStep(
    buildUid: string,
    buildParameters: BuildParameters,
    branchName: string | undefined,
    defaultSecretsArray: RemoteBuilderSecret[],
  ) {
    core.info('Starting step 3/4 build compression');
    // Cleanup
    await this.RemoteBuilderProviderPlatform.runBuildTask(
      buildUid,
      'alpine',
      [
        `
            apk update
            apk add zip
            cd Library
            zip -r lib-${buildUid}.zip .*
            mv lib-${buildUid}.zip /${buildVolumeFolder}/${cacheFolder}/${branchName}/lib-${buildUid}.zip
            cd ../../
            ls
            echo ' '
            ls ${buildParameters.buildPath}
            zip -r build-${buildUid}.zip ${buildParameters.buildPath}/*
            mv build-${buildUid}.zip /${buildVolumeFolder}/${buildUid}/build-${buildUid}.zip
          `,
      ],
      `/${buildVolumeFolder}`,
      `/${buildVolumeFolder}/${buildUid}/${repositoryFolder}/${buildParameters.projectPath}`,
      [
        {
          name: 'GITHUB_SHA',
          value: process.env.GITHUB_SHA || '',
        },
      ],
      defaultSecretsArray,
    );
    core.info('compression step complete');
  }

  private static async UploadArtifacts(
    buildUid: string,
    buildParameters: BuildParameters,
    branchName: string | undefined,
    defaultSecretsArray: RemoteBuilderSecret[],
  ) {
    core.info('Starting step 4/4 upload build to s3');
    await this.RemoteBuilderProviderPlatform.runBuildTask(
      buildUid,
      'amazon/aws-cli',
      [
        `
            aws s3 cp ${buildUid}/build-${buildUid}.zip s3://game-ci-storage/
            # no need to upload Library cache for now
            # aws s3 cp /${buildVolumeFolder}/${cacheFolder}/${branchName}/lib-${buildUid}.zip s3://game-ci-storage/
            ${this.SteamDeploy ? '#' : ''} rm -r ${buildUid}
          `,
      ],
      `/${buildVolumeFolder}`,
      `/${buildVolumeFolder}/`,
      [
        {
          name: 'GITHUB_SHA',
          value: process.env.GITHUB_SHA || '',
        },
        {
          name: 'AWS_DEFAULT_REGION',
          value: process.env.AWS_DEFAULT_REGION || '',
        },
      ],
      [
        {
          ParameterKey: 'AWSAccessKeyID',
          EnvironmentVariable: 'AWS_ACCESS_KEY_ID',
          ParameterValue: process.env.AWS_ACCESS_KEY_ID || '',
        },
        {
          ParameterKey: 'AWSSecretAccessKey',
          EnvironmentVariable: 'AWS_SECRET_ACCESS_KEY',
          ParameterValue: process.env.AWS_SECRET_ACCESS_KEY || '',
        },
        ...defaultSecretsArray,
      ],
    );
  }

  private static async DeployToSteam(
    buildUid: string,
    buildParameters: BuildParameters,
    defaultSecretsArray: RemoteBuilderSecret[],
  ) {
    core.info('Starting steam deployment');
    await this.RemoteBuilderProviderPlatform.runBuildTask(
      buildUid,
      'cm2network/steamcmd:root',
      [
        `
            ls
            ls /
            cp -r /${buildVolumeFolder}/${buildUid}/steam/action/entrypoint.sh /entrypoint.sh;
            cp -r /${buildVolumeFolder}/${buildUid}/steam/action/steps/ /steps;
            chmod -R +x /entrypoint.sh;
            chmod -R +x /steps;
            /entrypoint.sh;
            rm -r /${buildVolumeFolder}/${buildUid}
          `,
      ],
      `/${buildVolumeFolder}`,
      `/${buildVolumeFolder}/${buildUid}/steam/action/`,
      [
        {
          name: 'GITHUB_SHA',
          value: process.env.GITHUB_SHA || '',
        },
      ],
      [
        {
          EnvironmentVariable: 'INPUT_APPID',
          ParameterKey: 'appId',
          ParameterValue: process.env.APP_ID || '',
        },
        {
          EnvironmentVariable: 'INPUT_BUILDDESCRIPTION',
          ParameterKey: 'buildDescription',
          ParameterValue: process.env.BUILD_DESCRIPTION || '',
        },
        {
          EnvironmentVariable: 'INPUT_ROOTPATH',
          ParameterKey: 'rootPath',
          ParameterValue: buildParameters.buildPath,
        },
        {
          EnvironmentVariable: 'INPUT_RELEASEBRANCH',
          ParameterKey: 'releaseBranch',
          ParameterValue: process.env.RELEASE_BRANCH || '',
        },
        {
          EnvironmentVariable: 'INPUT_LOCALCONTENTSERVER',
          ParameterKey: 'localContentServer',
          ParameterValue: process.env.LOCAL_CONTENT_SERVER || '',
        },
        {
          EnvironmentVariable: 'INPUT_PREVIEWENABLED',
          ParameterKey: 'previewEnabled',
          ParameterValue: process.env.PREVIEW_ENABLED || '',
        },
        ...defaultSecretsArray,
      ],
    );
  }
}
export default RemoteBuilder;
