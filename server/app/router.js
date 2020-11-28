'use strict';
/**
 * @param {Egg.Application} app - egg application
 */
module.exports = app => {
  const { router, controller } = app;
  router.post('/upload', controller.home.fileUplod);
  router.post('/merge', controller.home.fileMerge);
  router.get('/check', controller.home.checkFile);
};
