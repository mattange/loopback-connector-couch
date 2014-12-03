(function() {
  var CouchConnector, debug, helpers, _;

  _ = require('lodash')._;

  debug = require('debug')('loopback:connector:couch');

  exports.initialize = function(dataSource, callback) {
    var connector;
    connector = new CouchConnector(dataSource);
    return callback && process.nextTick(callback);
  };

  CouchConnector = (function() {
    function CouchConnector(dataSource) {
      var design, k, settings, v, viewFn, _ref, _ref1, _ref2, _ref3, _ref4;
      this.dataSource = dataSource;
      dataSource.connector = this;
      settings = dataSource.settings || {};
      this.settings = settings;
      helpers.optimizeSettings(settings);
      design = {
        views: {
          by_model: {
            map: 'function (doc) { if (doc.loopbackModel) return emit(doc.loopbackModel, null); }'
          }
        }
      };
      if ((_ref = settings.auth) != null ? _ref.reader : void 0) {
        this._nanoReader = require('nano')(this.buildAuthUrl(settings.auth.reader));
      }
      if ((_ref1 = settings.auth) != null ? _ref1.writer : void 0) {
        this._nanoWriter = require('nano')(this.buildAuthUrl(settings.auth.writer));
      }
      if ((_ref2 = settings.auth) != null ? _ref2.admin : void 0) {
        this._nanoAdmin = require('nano')(this.buildAuthUrl(settings.auth.admin));
      }
      if (!this._nanoReader) {
        this._nanoReader = require('nano')(this.buildAuthUrl(settings.auth));
      }
      if (!this._nanoWriter) {
        this._nanoWriter = require('nano')(this.buildAuthUrl(settings.auth));
      }
      if (!this._nanoAdmin) {
        this._nanoAdmin = require('nano')(this.buildAuthUrl(settings.auth));
      }
      helpers.updateDesign(this._nanoAdmin, '_design/loopback', design);
      this._models = {};
      this.name = 'couchdb';
      if (settings.views && _.isArray(settings.views)) {
        this.DataAccessObject = function() {};
        if (dataSource.constructor.DataAccessObject) {
          _ref3 = dataSource.constructor.DataAccessObject;
          for (k in _ref3) {
            v = _ref3[k];
            this.DataAccessObject[k] = v;
          }
          _ref4 = dataSource.constructor.DataAccessObject.prototype;
          for (k in _ref4) {
            v = _ref4[k];
            this.DataAccessObject.prototype[k] = v;
          }
        }
        viewFn = this.buildViewEndpoint(settings.views);
        this.DataAccessObject.queryView = viewFn;
        dataSource.queryView = viewFn;
      }
      return this;
    }

    CouchConnector.prototype.relational = false;

    CouchConnector.prototype.getDefaultIdType = function() {
      return String;
    };

    CouchConnector.prototype.getTypes = function() {
      return ['db', 'nosql', 'couchdb'];
    };

    CouchConnector.prototype.getMetadata = function() {
      if (!this._metaData) {
        this._metaData = {
          types: this.getTypes(),
          defaultIdType: this.getDefaultIdType(),
          isRelational: this.isRelational,
          schemaForSettings: {}
        };
      }
      return this._metaData;
    };

    CouchConnector.prototype.define = function(descr) {
      var design, designName, hasIndexes, modelName, propName, value, viewName, _ref;
      modelName = descr.model.modelName;
      this._models[modelName] = descr;
      descr.properties._rev = {
        type: String
      };
      design = {
        views: {}
      };
      hasIndexes = false;
      _ref = descr.properties;
      for (propName in _ref) {
        value = _ref[propName];
        if (value.index) {
          hasIndexes = true;
          viewName = helpers.viewName(propName);
          design.views[viewName] = {
            map: 'function (doc) { if (doc.loopbackModel === \'' + modelName + '\' && doc.' + propName + ') return emit(doc.' + propName + ', null); }'
          };
        }
      }
      if (hasIndexes) {
        designName = '_design/' + helpers.designName(modelName);
        return helpers.updateDesign(this._nanoAdmin, designName, design);
      }
    };

    CouchConnector.prototype.create = function(model, data, callback) {
      debug('CouchDB create');
      return this.save(model, data, callback);
    };

    CouchConnector.prototype.save = function(model, data, callback) {
      debug('CouchDB save');
      if (!data) {
        return callback && callback("Cannot create an empty document in the database");
      }
      delete data._deleted;
      return this._nanoWriter.insert(this.forDB(model, data), (function(_this) {
        return function(err, rsp) {
          if (err) {
            return callback(err);
          }
          helpers.undoPrep(data);
          data._rev = rsp.rev;
          return callback && callback(null, rsp.id, rsp.rev);
        };
      })(this));
    };

    CouchConnector.prototype.updateOrCreate = function(model, data, callback) {
      debug('CouchDB updateOrCreate');
      delete data._deleted;
      return this.save(model, data, function(err, id, rev) {
        if (err) {
          return callback && callback(err);
        }
        data.id = id;
        data._rev = rev;
        return callback && callback(null, data);
      });
    };

    CouchConnector.prototype.update = function(model, where, data, callback) {
      debug('CouchDB update');
      delete data._deleted;
      return this.all(model, {
        where: where
      }, (function(_this) {
        return function(err, docsFromDb) {
          var doc, docs;
          if (err) {
            return callback && callback(err);
          }
          helpers.merge(docsFromDb, data);
          if (!_.isArray(docsFromDb)) {
            docsFromDb = [docsFromDb];
          }
          docs = (function() {
            var _i, _len, _results;
            _results = [];
            for (_i = 0, _len = docsFromDb.length; _i < _len; _i++) {
              doc = docsFromDb[_i];
              _results.push(this.forDB(model, doc));
            }
            return _results;
          }).call(_this);
          debug(docs);
          return _this._nanoWriter.bulk({
            docs: docs
          }, function(err, rsp) {
            return callback && callback(err, rsp);
          });
        };
      })(this));
    };

    CouchConnector.prototype.updateAttributes = function(model, id, attributes, callback) {
      debug('CouchDB updateAttributes');
      delete attributes._deleted;
      return this._nanoReader.get(id, (function(_this) {
        return function(err, doc) {
          if (err) {
            return callback && callback(err);
          }
          return _this.save(model, helpers.merge(doc, attributes), function(err, rsp) {
            if (err) {
              return callback && callback(err);
            }
            doc._rev = rsp.rev;
            return callback && callback(null, doc);
          });
        };
      })(this));
    };

    CouchConnector.prototype.destroyAll = function(model, where, callback) {
      debug('CouchDB destroyAll');
      return this.all(model, {
        where: where
      }, (function(_this) {
        return function(err, docs) {
          var doc;
          if (err) {
            return callback && callback(err);
          }
          debug(docs);
          docs = (function() {
            var _i, _len, _results;
            _results = [];
            for (_i = 0, _len = docs.length; _i < _len; _i++) {
              doc = docs[_i];
              _results.push({
                _id: doc.id,
                _rev: doc._rev,
                _deleted: true
              });
            }
            return _results;
          })();
          return _this._nanoWriter.bulk({
            docs: docs
          }, function(err, rsp) {
            return callback && callback(err, rsp);
          });
        };
      })(this));
    };

    CouchConnector.prototype.count = function(model, callback, where) {
      debug('CouchDB count');
      return this.all(model, {
        where: where
      }, (function(_this) {
        return function(err, docs) {
          if (err) {
            return callback && callback(err);
          }
          return callback && callback(null, docs.length);
        };
      })(this));
    };

    CouchConnector.prototype.all = function(model, filter, callback) {
      var designName, id, params, propName, props, value, viewName, where, _ref;
      debug('CouchDB all');
      debug(filter);
      if (id = filter != null ? (_ref = filter.where) != null ? _ref.id : void 0 : void 0) {
        debug('...moving to findById from all');
        return this.findById(model, id, callback);
      }
      params = {
        keys: [model],
        include_docs: true
      };
      if (filter.offset && !filter.where) {
        params.skip = filter.offset;
      }
      if (filter.limit && !filter.where) {
        params.limit = filter.limit;
      }
      designName = 'loopback';
      viewName = 'by_model';
      if (where = filter != null ? filter.where : void 0) {
        props = this._models[model].properties;
        for (propName in where) {
          value = where[propName];
          if (value && (props[propName] != null) && props[propName].index) {
            designName = helpers.designName(model);
            viewName = helpers.viewName(propName);
            params.key = _.isDate(value) ? value.getTime() : value;
            delete params.keys;
            break;
          }
        }
      }
      return this._nanoReader.view(designName, viewName, params, (function(_this) {
        return function(err, body) {
          var doc, docs, i, k, key, maxDocsNum, orders, output, row, sorting, startDocsNum, v, _i, _len;
          if (err) {
            return callback && callback(err);
          }
          docs = (function() {
            var _i, _len, _ref1, _results;
            _ref1 = body.rows;
            _results = [];
            for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
              row = _ref1[_i];
              row.doc.id = row.doc._id;
              delete row.doc._id;
              _results.push(row.doc);
            }
            return _results;
          })();
          debug("CouchDB all: docs before where");
          debug(docs);
          if (where = filter != null ? filter.where : void 0) {
            for (k in where) {
              v = where[k];
              if (_.isDate(v)) {
                where[k] = v.getTime();
              }
            }
            docs = _.where(docs, where);
          }
          debug("CouchDB all: docs after where");
          debug(docs);
          if (orders = filter != null ? filter.order : void 0) {
            if (_.isString(orders)) {
              orders = [orders];
            }
            sorting = function(a, b) {
              var ak, bk, i, item, rev, _i, _len;
              for (i = _i = 0, _len = this.length; _i < _len; i = ++_i) {
                item = this[i];
                ak = a[this[i].key];
                bk = b[this[i].key];
                rev = this[i].reverse;
                if (ak > bk) {
                  return 1 * rev;
                }
                if (ak < bk) {
                  return -1 * rev;
                }
              }
              return 0;
            };
            for (i = _i = 0, _len = orders.length; _i < _len; i = ++_i) {
              key = orders[i];
              orders[i] = {
                reverse: helpers.reverse(key),
                key: helpers.stripOrder(key)
              };
            }
            docs.sort(sorting.bind(orders));
          }
          if ((filter != null ? filter.limit : void 0) && (filter != null ? filter.where : void 0)) {
            maxDocsNum = filter.limit;
          } else {
            maxDocsNum = docs.length;
          }
          if ((filter != null ? filter.offset : void 0) && (filter != null ? filter.where : void 0)) {
            startDocsNum = filter.offset;
          } else {
            startDocsNum = 0;
          }
          docs = docs.slice(startDocsNum, maxDocsNum);
          output = (function() {
            var _j, _len1, _results;
            _results = [];
            for (_j = 0, _len1 = docs.length; _j < _len1; _j++) {
              doc = docs[_j];
              _results.push(this.fromDB(model, doc));
            }
            return _results;
          }).call(_this);
          return callback(null, output);
        };
      })(this));
    };

    CouchConnector.prototype.forDB = function(model, data) {
      var k, props, v;
      if (data == null) {
        data = {};
      }
      helpers.savePrep(model, data);
      props = this._models[model].properties;
      for (k in props) {
        v = props[k];
        if (data[k] && props[k].type.name === 'Date' && (data[k].getTime != null)) {
          data[k] = data[k].getTime();
        }
      }
      return data;
    };

    CouchConnector.prototype.fromDB = function(model, data) {
      var date, k, props, v;
      if (!data) {
        return data;
      }
      helpers.undoPrep(data);
      props = this._models[model].properties;
      for (k in props) {
        v = props[k];
        if ((data[k] != null) && props[k].type.name === 'Date') {
          date = new Date(data[k]);
          date.setTime(data[k]);
          data[k] = date;
        }
      }
      return data;
    };

    CouchConnector.prototype.exists = function(model, id, callback) {
      debug('CouchdDB exists');
      return this._nanoReader.head(id, function(err, _, headers) {
        if (err) {
          return callback && callback(null, 0);
        }
        return callback && callback(null, 1);
      });
    };

    CouchConnector.prototype.getLatestRevision = function(model, id, callback) {
      return this._nanoReader.head(id, function(err, _, headers) {
        var rev;
        if (err) {
          return callback && callback(err);
        }
        rev = headers.etag.substr(1, headers.etag.length - 2);
        return callback && callback(null, rev);
      });
    };

    CouchConnector.prototype.destroy = function(model, id, callback) {
      debug('CouchDB destroy');
      return this.getLatestRevision(model, id, (function(_this) {
        return function(err, rev) {
          if (err) {
            return callback && callback(err);
          }
          return _this._nanoWriter.destroy(id, rev, function(err, rsp) {
            return callback && callback(err, rsp);
          });
        };
      })(this));
    };

    CouchConnector.prototype.findById = function(model, id, callback) {
      debug('CouchDB findById');
      return this._nanoReader.get(id, (function(_this) {
        return function(err, doc) {
          debug(err, doc);
          if (err && err.statusCode === 404) {
            return callback && callback(null, []);
          }
          if (err) {
            return callback && callback(err);
          }
          return callback && callback(null, [_this.fromDB(model, doc)]);
        };
      })(this));
    };

    CouchConnector.prototype.viewFunction = function(model, ddoc, viewname, keys, callback) {
      var params, view;
      ddoc = ddoc ? ddoc : this.settings.database || this.settings.db;
      view = _.findWhere(this._availableViews, {
        ddoc: ddoc,
        name: viewname
      });
      if (!view) {
        return callback && callback("The requested view is not available in the datasource");
      }
      params = keys;
      if (typeof keys === 'function') {
        callback = keys;
        params = {};
      }
      if (typeof keys === 'string') {
        params = {
          keys: [keys]
        };
      }
      if (_.isArray(keys)) {
        params = {
          keys: keys
        };
      }
      debug(model, ddoc, viewname, params);
      return this._nanoReader.view(ddoc, viewname, params, (function(_this) {
        return function(err, rsp) {
          var doc, docs;
          if (err) {
            return callback && callback(err);
          }
          docs = _.pluck(rsp.rows, 'value');
          return callback && callback(null, (function() {
            var _i, _len, _results;
            _results = [];
            for (_i = 0, _len = docs.length; _i < _len; _i++) {
              doc = docs[_i];
              _results.push(this.fromDB(model, doc));
            }
            return _results;
          }).call(_this));
        };
      })(this));
    };

    CouchConnector.prototype.buildViewEndpoint = function(views) {
      var fn;
      this._availableViews = views;
      fn = _.bind(this.viewFunction, this);
      fn.accepts = [
        {
          arg: 'modelName',
          type: "string",
          description: "The current model name",
          required: false,
          http: function(ctx) {
            return ctx.method.sharedClass.name;
          }
        }, {
          arg: 'ddoc',
          type: "string",
          description: "The design document name for the requested view. Defaults to CouchDB database name used for this data.",
          required: false,
          http: {
            source: 'query'
          }
        }, {
          arg: 'viewname',
          type: "string",
          description: "The view name requested.",
          required: true,
          http: {
            source: 'query'
          }
        }, {
          arg: 'keys',
          type: "object",
          description: "The index(es) requested to narrow view results. Parameter can be a string, array of strings or object with 'key' or with 'startkey' and 'endkey', as per CouchDB. Use the object version for complex keys querying.",
          required: false,
          http: {
            source: 'query'
          }
        }
      ];
      fn.returns = {
        arg: 'items',
        type: "array"
      };
      fn.shared = true;
      fn.http = {
        path: '/queryView',
        verb: 'get'
      };
      fn.description = "Query a CouchDB view based on design document name, view name and keys.";
      return fn;
    };

    CouchConnector.prototype.buildAuthUrl = function(auth) {
      var authString, url;
      if (auth && (auth.username || auth.user) && (auth.password || auth.pass)) {
        authString = (auth.username || auth.user) + ':' + (auth.password || auth.pass) + '@';
      } else {
        authString = '';
      }
      url = this.settings.protocol + '://' + authString + this.settings.hostname + ':' + this.settings.port + '/' + this.settings.database;
      return url;
    };

    return CouchConnector;

  })();

  helpers = {
    optimizeSettings: function(settings) {
      settings.hostname = settings.hostname || settings.host || '127.0.0.1';
      settings.protocol = settings.protocol || 'http';
      settings.port = settings.port || 5984;
      settings.database = settings.database || settings.db;
      if (!settings.database) {
        throw new Error("Database name must be specified in dataSource for CouchDB connector");
      }
    },
    merge: function(base, update) {
      if (!base) {
        return update;
      }
      if (!_.isArray(base)) {
        _.extend(base, update);
      } else {
        _.each(base, function(doc) {
          return _.extend(doc, update);
        });
      }
      return base;
    },
    reverse: function(key) {
      var hasOrder;
      if (hasOrder = key.match(/\s+(A|DE)SC$/i)) {
        if (hasOrder[1] === "DE") {
          return -1;
        }
      }
      return 1;
    },
    stripOrder: function(key) {
      return key.replace(/\s+(A|DE)SC/i, "");
    },
    savePrep: function(model, data) {
      var id;
      if (id = data.id) {
        data._id = id.toString();
      }
      delete data.id;
      if (data._rev === null) {
        delete data._rev;
      }
      if (model) {
        data.loopbackModel = model;
      }
    },
    undoPrep: function(data) {
      var _id;
      if (_id = data._id) {
        data.id = _id.toString();
      }
      delete data._id;
      delete data.loopbackModel;
    },
    designName: function(modelName) {
      return 'loopback_' + modelName;
    },
    viewName: function(propName) {
      return 'by_' + propName;
    },
    invokeCallbackOrLogError: function(callback, err, res) {
      if (callback) {
        return callback && callback(err, res);
      } else if (err) {
        return console.log(err);
      }
    },
    updateDesign: function(db, designName, design, callback) {
      return db.get(designName, (function(_this) {
        return function(err, designDoc) {
          if (err && err.error !== 'not_found') {
            return helpers.invokeCallbackOrLogError(callback, err, designDoc);
          }
          if (!designDoc) {
            designDoc = design;
          } else {
            if (_.isEqual(designDoc.views, design.views)) {
              return helpers.invokeCallbackOrLogError(callback, null, designDoc);
            }
            designDoc.views = design.views;
          }
          return db.insert(designDoc, designName, function(err, insertedDoc) {
            return helpers.invokeCallbackOrLogError(callback, err, insertedDoc);
          });
        };
      })(this));
    }
  };

}).call(this);

//# sourceMappingURL=couch.js.map
