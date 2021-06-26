import * as core from '@actions/core';
import { Action, BuildParameters, Cache, Docker, ImageTag, Output, RemoteBuilder } from './model';

async function run() {
  try {
    Action.checkCompatibility();
    Cache.verify();

    const { dockerfile, workspace, actionFolder } = Action;

    const buildParameters = await BuildParameters.create();
    const baseImage = new ImageTag(buildParameters);
    let builtImage;

    switch (buildParameters.remoteBuildCluster) {
      case 'aws':
      case 'k8s':
        await RemoteBuilder.build(buildParameters, baseImage);
        break;

      // default and local case
      default:
        core.info('Building locally');
        builtImage = await Docker.build({ path: actionFolder, dockerfile, baseImage });
        await Docker.run(builtImage, { workspace, ...buildParameters });
        break;
    }

    // Set output
    await Output.setBuildVersion(buildParameters.buildVersion);
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
