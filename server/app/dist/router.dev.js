'use strict';
/**
 * @param {Egg.Application} app - egg application
 */

module.exports = function (app) {
  var router = app.router,
      controller = app.controller;
  router.post('/upload', controller.home.fileUplod);
  router.post('/merge', controller.home.fileMerge);
  router.get('/check', controller.home.checkFile);
};