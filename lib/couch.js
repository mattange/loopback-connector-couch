(function() {
  var NanoAdapter, helpers, _,
    __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __slice = [].slice;

  _ = require('lodash')._;

  exports.initialize = function(schema, callback) {
    var db, design, opts;
    if (!schema.settings.url) {
      schema.settings.url = "http" + (schema.settings.ssl ? "s" : "") + "://";
      if (schema.settings.username && schema.settings.password) {
        schema.settings.url += schema.settings.username + ":" + schema.settings.password + "@";
      }
      schema.settings.url += schema.settings.host;
      if (schema.settings.port) {
        schema.settings.url += ":" + schema.settings.port;
      }
      if (schema.settings.database) {
        schema.settings.url += "/" + schema.settings.database;
      }
    }
    if (!(opts = schema.settings)) {
      throw new Error('url is missing');
    }
    db = require('nano')(opts);
    schema.adapter = new NanoAdapter(db);
    design = {
      views: {
        by_model: {
          map: 'function (doc) { if (doc.model) return emit(doc.model, null); }'
        }
      }
    };
    return helpers.updateDesign(db, '_design/nano', design, callback);
  };

  NanoAdapter = (function() {
    function NanoAdapter(db) {
      this.db = db;
      this.table = __bind(this.table, this);
      this.defineProperty = __bind(this.defineProperty, this);
      this.defineForeignKey = __bind(this.defineForeignKey, this);
      this.all = __bind(this.all, this);
      this.fromDB = __bind(this.fromDB, this);
      this.forDB = __bind(this.forDB, this);
      this.destroyAll = __bind(this.destroyAll, this);
      this.count = __bind(this.count, this);
      this.updateAttributes = __bind(this.updateAttributes, this);
      this.destroy = __bind(this.destroy, this);
      this.find = __bind(this.find, this);
      this.exists = __bind(this.exists, this);
      this.updateOrCreate = __bind(this.updateOrCreate, this);
      this.save = __bind(this.save, this);
      this.create = __bind(this.create, this);
      this.define = __bind(this.define, this);
      this._models = {};
    }

    NanoAdapter.prototype.define = function(descr) {
      var design, designName, hasIndexes, modelName, propName, value, viewName, _ref;
      descr.properties._rev = {
        type: String
      };
      modelName = descr.model.modelName;
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
            map: 'function (doc) { if (doc.model === \'' + modelName + '\') return emit(doc.' + propName + ', null); }'
          };
        }
      }
      if (hasIndexes) {
        designName = '_design/' + helpers.designName(modelName);
        helpers.updateDesign(this.db, designName, design);
      }
      return this._models[modelName] = descr;
    };

    NanoAdapter.prototype.create = function() {
      var args;
      args = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
      return this.save.apply(this, args);
    };

    NanoAdapter.prototype.save = function(model, data, callback) {
      data.model = this.table(model);
      helpers.savePrep(data);
      return this.db.insert(this.forDB(model, data), (function(_this) {
        return function(err, doc) {
          if (err) {
            return callback(err);
          }
          helpers.undoPrep(data);
          data._rev = doc.rev;
          return callback(null, doc.id, doc.rev);
        };
      })(this));
    };

    NanoAdapter.prototype.updateOrCreate = function(model, data, callback) {
      if (data == null) {
        data = {};
      }
      return this.exists(model, data.id, (function(_this) {
        return function(err, exists) {
          if (err) {
            return callback(err);
          }
          if (exists) {
            return _this.save(model, data, callback);
          }
          return _this.create(model, data, function(err, id) {
            if (err) {
              return callback(err);
            }
            data.id = id;
            return callback(null, data);
          });
        };
      })(this));
    };

    NanoAdapter.prototype.exists = function(model, id, callback) {
      return this.db.head(id, function(err, _, headers) {
        if (err) {
          return callback(null, false);
        }
        return callback(null, headers != null);
      });
    };

    NanoAdapter.prototype.find = function(model, id, callback) {
      return this.db.get(id, (function(_this) {
        return function(err, doc) {
          if (err && err.status_code === 404) {
            return callback(null, null);
          }
          if (err) {
            return callback(err);
          }
          return callback(null, _this.fromDB(model, doc));
        };
      })(this));
    };

    NanoAdapter.prototype.destroy = function(model, id, callback) {
      return this.db.get(id, (function(_this) {
        return function(err, doc) {
          if (err) {
            return callback(err);
          }
          return _this.db.destroy(id, doc._rev, function(err, doc) {
            if (err) {
              return callback(err);
            }
            callback.removed = true;
            return callback(null);
          });
        };
      })(this));
    };

    NanoAdapter.prototype.updateAttributes = function(model, id, data, callback) {
      return this.db.get(id, (function(_this) {
        return function(err, base) {
          if (err) {
            return callback(err);
          }
          return _this.save(model, helpers.merge(base, data), callback);
        };
      })(this));
    };

    NanoAdapter.prototype.count = function(model, callback, where) {
      return this.all(model, {
        where: where
      }, (function(_this) {
        return function(err, docs) {
          if (err) {
            return callback(err);
          }
          return callback(null, docs.length);
        };
      })(this));
    };

    NanoAdapter.prototype.destroyAll = function(model, callback) {
      return this.all(model, {}, (function(_this) {
        return function(err, docs) {
          var doc;
          if (err) {
            return callback(err);
          }
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
          return _this.db.bulk({
            docs: docs
          }, callback);
        };
      })(this));
    };

    NanoAdapter.prototype.forDB = function(model, data) {
      var k, props, v;
      if (data == null) {
        data = {};
      }
      props = this._models[model].properties;
      for (k in props) {
        v = props[k];
        if (data[k] && props[k].type.name === 'Date' && (data[k].getTime != null)) {
          data[k] = data[k].getTime();
        }
      }
      return data;
    };

    NanoAdapter.prototype.fromDB = function(model, data) {
      var date, k, props, v;
      if (!data) {
        return data;
      }
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

    NanoAdapter.prototype.all = function(model, filter, callback) {
      var designName, params, propName, props, value, viewName, where;
      params = {
        keys: [this.table(model)],
        include_docs: true
      };
      if (filter.offset) {
        params.skip = filter.offset;
      }
      if (filter.limit) {
        params.limit = filter.limit;
      }
      designName = 'nano';
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
      return this.db.view(designName, viewName, params, (function(_this) {
        return function(err, body) {
          var doc, docs, i, k, key, orders, row, sorting, v, _i, _len;
          if (err) {
            return callback(err);
          }
          docs = (function() {
            var _i, _len, _ref, _results;
            _ref = body.rows;
            _results = [];
            for (_i = 0, _len = _ref.length; _i < _len; _i++) {
              row = _ref[_i];
              row.doc.id = row.doc._id;
              delete row.doc._id;
              _results.push(row.doc);
            }
            return _results;
          })();
          if (where = filter != null ? filter.where : void 0) {
            for (k in where) {
              v = where[k];
              if (_.isDate(v)) {
                where[k] = v.getTime();
              }
            }
            docs = _.where(docs, where);
          }
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
          if (filter != null ? filter.limit : void 0) {
            docs = docs.slice(0, filter.limit);
          }
          return callback(null, (function() {
            var _j, _len1, _results;
            _results = [];
            for (_j = 0, _len1 = docs.length; _j < _len1; _j++) {
              doc = docs[_j];
              _results.push(this.fromDB(model, doc));
            }
            return _results;
          }).call(_this));
        };
      })(this));
    };

    NanoAdapter.prototype.defineForeignKey = function(model, key, callback) {
      return callback(null, String);
    };

    NanoAdapter.prototype.defineProperty = function(model, prop, params) {
      return this._models[model].properties[prop] = params;
    };

    NanoAdapter.prototype.table = function(model) {
      return this._models[model].model.tableName;
    };

    return NanoAdapter;

  })();

  helpers = {
    merge: function(base, update) {
      var k, v;
      if (!base) {
        return update;
      }
      for (k in update) {
        v = update[k];
        base[k] = update[k];
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
    savePrep: function(data) {
      var id;
      if (id = data.id) {
        data._id = id.toString();
      }
      delete data.id;
      if (data._rev === null) {
        return delete data._rev;
      }
    },
    undoPrep: function(data) {
      var _id;
      if (_id = data._id) {
        data.id = _id.toString();
      }
      delete data._id;
    },
    designName: function(modelName) {
      return 'nano-' + modelName;
    },
    viewName: function(propName) {
      return 'by_' + propName;
    },
    invokeCallbackOrLogError: function(callback, err, res) {
      if (callback) {
        return callback(err, res);
      } else if (err) {
        return console.log(err);
      }
    },
    updateDesign: function(db, designName, design, callback) {
      return db.get(designName, (function(_this) {
        return function(err, designDoc) {
          if (err && err.error !== 'not_found') {
            helpers.invokeCallbackOrLogError(callback, err, designDoc);
            return;
          }
          if (!designDoc) {
            designDoc = design;
          } else {
            if (_.isEqual(designDoc.views, design.views)) {
              helpers.invokeCallbackOrLogError(callback, null, designDoc);
              return;
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
