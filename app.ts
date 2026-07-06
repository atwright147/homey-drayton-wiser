import Homey from 'homey';
import WiserHubManager from './lib/wiser-hub-manager';

class DraytonWiserApp extends Homey.App {
  public hubManager!: WiserHubManager;

  async onInit(): Promise<void> {
    this.log('Drayton Wiser has been initialized');
    this.hubManager = new WiserHubManager();
  }
}

module.exports = DraytonWiserApp;
