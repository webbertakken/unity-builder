import { customAlphabet } from 'nanoid';
import RemoteBuilderConstants from './remote-builder-constants';

class RemoteBuilderNamespace {
  static generateBuildName(runNumber: string | number, platform: string) {
    const nanoid = customAlphabet(RemoteBuilderConstants.alphabet, 4);
    return `${runNumber}-${platform.toLowerCase().replace('standalone', '')}-${nanoid()}`;
  }
}
export default RemoteBuilderNamespace;
