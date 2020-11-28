/* eslint valid-jsdoc: "off" */

'use strict';

/**
 * @param {Egg.EggAppInfo} appInfo app info
 */
module.exports = appInfo => {
  /**
   * built-in config
   * @type {Egg.EggAppConfig}
   **/
  const config = {}
  config.multipart  = {
    mode: 'file',
    whitelist: () => true,
    fileSize: 1000*1024*1024,
    files: 100,
    tmpdir: ''
  };

  config.security = {
      csrf: {
        enable: false,
      },
  }
  config.cookies = {
    httpOnly: false
  }

  // use for cookie sign key, should change to your own and keep security
  config.keys = 'yuanchenglang@!#vue';

  // add your middleware config here
  config.middleware = [];

  // add your user config here
  const userConfig = {
    // myAppName: 'egg',
  };

  return {
    ...config,
    ...userConfig,
  };
};
