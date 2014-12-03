{_} = require 'lodash'
debug = require('debug')('loopback:connector:couch')

# api
exports.initialize = (dataSource, callback) ->
	connector = new CouchConnector  dataSource
	return callback && process.nextTick callback

#Constructor and useful reference functions
class CouchConnector
	constructor: (dataSource) ->
		
		@dataSource = dataSource
		dataSource.connector = this
		
		settings = dataSource.settings or {}
		@settings = settings
		helpers.optimizeSettings settings
		
		design = views: by_model: map:
			'function (doc) { if (doc.loopbackModel) return emit(doc.loopbackModel, null); }'
		
		if settings.auth?.reader
			@_nanoReader = require('nano')(@buildAuthUrl(settings.auth.reader))
		if settings.auth?.writer
			@_nanoWriter = require('nano')(@buildAuthUrl(settings.auth.writer))
		if settings.auth?.admin
			@_nanoAdmin = require('nano')(@buildAuthUrl(settings.auth.admin))

		@_nanoReader = require('nano')(@buildAuthUrl(settings.auth)) if not @_nanoReader
		@_nanoWriter = require('nano')(@buildAuthUrl(settings.auth)) if not @_nanoWriter
		@_nanoAdmin = require('nano')(@buildAuthUrl(settings.auth)) if not @_nanoAdmin
		
		helpers.updateDesign @_nanoAdmin, '_design/loopback', design
		@_models = {}
		@name = 'couchdb'
		if settings.views and _.isArray settings.views
			@DataAccessObject = () ->
			#add existing methods
			if dataSource.constructor.DataAccessObject
				for k,v of dataSource.constructor.DataAccessObject
					@DataAccessObject[k] = v
				for k,v of dataSource.constructor.DataAccessObject.prototype
					@DataAccessObject.prototype[k] = v
			#then add connector method
			viewFn = @buildViewEndpoint settings.views
			@DataAccessObject.queryView = viewFn
			dataSource.queryView = viewFn

		return this
	
	relational: false
	
	getDefaultIdType: () -> 
		return String
	
	getTypes: () ->
		return ['db', 'nosql', 'couchdb']

	getMetadata: () ->
		unless @_metaData
			@_metaData =
				types: @getTypes()
				defaultIdType: @getDefaultIdType()
				isRelational: @isRelational
				schemaForSettings: {}
		return @_metaData

	define: (descr) ->
		modelName = descr.model.modelName

		@_models[modelName] = descr
		descr.properties._rev = type: String
		# Add index views for schemas that have indexes
		design =
			views: {}
		hasIndexes = false
		for propName, value of descr.properties
			if value.index
				hasIndexes = true
				viewName = helpers.viewName propName
				design.views[viewName] =
					map: 'function (doc) { if (doc.loopbackModel === \'' + modelName + '\' && doc.'+propName + ') return emit(doc.' + propName + ', null); }'
		if hasIndexes
			designName = '_design/' + helpers.designName modelName
			helpers.updateDesign @_nanoAdmin, designName, design

#Loopback.io prototype functions
	create: (model, data, callback) ->
		debug 'CouchDB create'
		@save model, data, callback

	save: (model, data, callback) ->
		debug 'CouchDB save'
		return callback and callback "Cannot create an empty document in the database" if not data
		delete data._deleted 		# Prevents accidental deletion via save command
		@_nanoWriter.insert @forDB(model, data), (err, rsp) =>
			return callback err if err
			# Undo the effects of savePrep as data object is the only one
			# that the Loopback.io can access.
			helpers.undoPrep data
			# Update the data object with the revision returned by CouchDb.
			data._rev = rsp.rev
			return callback and callback null, rsp.id, rsp.rev 

	updateOrCreate: (model, data, callback) ->
		debug 'CouchDB updateOrCreate'
		delete data._deleted		# Prevents accidental deletion 
		return @save model, data, (err, id, rev) ->
			return callback and callback err if err
			data.id = id
			data._rev = rev
			return callback and callback null, data

	update: (model, where, data, callback) ->
		debug 'CouchDB update'
		delete data._deleted		# Prevents accidental deletion 
		@all model, {where}, (err, docsFromDb) =>
			return callback and callback err if err
			helpers.merge(docsFromDb, data)
			if (not _.isArray docsFromDb)
				docsFromDb = [docsFromDb]
			docs = (@forDB model, doc for doc in docsFromDb)
			debug docs
			@_nanoWriter.bulk {docs}, (err, rsp) ->
				return callback and callback err, rsp
			
	updateAttributes: (model, id, attributes, callback) ->
		debug 'CouchDB updateAttributes'
		delete attributes._deleted	#prevent accidental deletion
		@_nanoReader.get id, (err, doc) =>
			return callback and callback err if err
			@save model, helpers.merge(doc, attributes), (err, rsp) ->
				return callback and callback err if err
				doc._rev = rsp.rev
				return callback and callback null, doc

	destroyAll: (model, where, callback) ->
		debug 'CouchDB destroyAll'
		@all model, {where}, (err, docs) =>
			return callback and callback err if err
			debug docs
			docs = for doc in docs
				{_id: doc.id, _rev: doc._rev, _deleted: yes}
			@_nanoWriter.bulk {docs}, (err, rsp) ->
				return callback and callback err, rsp

	count: (model, callback, where) ->
		debug 'CouchDB count'
		@all model, {where}, (err, docs) =>
			return callback and callback err if err
			callback and callback null, docs.length

	all: (model, filter, callback) ->
		debug 'CouchDB all'
		debug filter
		# Consider first the easy case that a specific id is requested
		if id = filter?.where?.id
			debug '...moving to findById from all'
			return @findById(model, id, callback)
		
		params =
			keys: [model]
			include_docs: yes
		params.skip = filter.offset if filter.offset and not filter.where
		params.limit = filter.limit if filter.limit and not filter.where		#if you have a where clause and a limit first get all the data and then limit them

		# We always fallback on loopback/by_model view as it allows us
		# to iterate over all the docs for a model. But check if
		# there is a specialized view for one of the where conditions.
		designName = 'loopback'
		viewName = 'by_model'
		if where = filter?.where
			props = @_models[model].properties
			for propName, value of where
				# We can use an optimal view when a where "clause" uses an indexed property
				if value and props[propName]? and props[propName].index
					# Use the design and view for the model and propName
					designName = helpers.designName model
					viewName = helpers.viewName propName
					# CouchDb stores dates as Unix time
					params.key = if _.isDate value then value.getTime() else value
					# We don't want to use keys - we now have a key property
					delete params.keys
					break

		@_nanoReader.view designName, viewName, params, (err, body) =>
			return callback and callback err if err
			docs = for row in body.rows
				row.doc.id = row.doc._id
				delete row.doc._id
				row.doc
			
			
			debug "CouchDB all: docs before where"
			debug docs

			if where = filter?.where
				for k, v of where
					# CouchDb stores dates as Unix time
					where[k] = v.getTime() if _.isDate v
				docs = _.where docs, where

			
			debug "CouchDB all: docs after where"
			debug docs

			if orders = filter?.order
				orders = [orders] if _.isString orders
				sorting = (a, b) ->
					for item, i in @
						ak = a[@[i].key]; bk = b[@[i].key]; rev = @[i].reverse
						if ak > bk then return 1 * rev
						if ak < bk then return -1 * rev
					0

				for key, i in orders
					orders[i] =
						reverse: helpers.reverse key
						key: helpers.stripOrder key

				docs.sort sorting.bind orders
			
			if filter?.limit and filter?.where
				maxDocsNum = filter.limit
			else
				maxDocsNum = docs.length
			if filter?.offset and filter?.where
				startDocsNum = filter.offset
			else
				startDocsNum = 0
			
			docs = docs.slice startDocsNum, maxDocsNum
			output = (@fromDB model, doc for doc in docs)
			return callback null, output
					

	forDB: (model, data = {}) ->
		helpers.savePrep model, data
		props = @_models[model].properties
		for k, v of props
			if data[k] and props[k].type.name is 'Date' and data[k].getTime?
				data[k] = data[k].getTime()
		data

	fromDB: (model, data) ->
		return data unless data
		helpers.undoPrep data
		props = @_models[model].properties
		for k, v of props
			if data[k]? and props[k].type.name is 'Date'
				date = new Date data[k]
				date.setTime data[k]
				data[k] = date
		data

	exists: (model, id, callback) ->
		debug 'CouchdDB exists'
		@_nanoReader.head id, (err, _, headers) ->
			return callback and callback null, 0 if err
			callback && callback null, 1
	
	getLatestRevision: (model, id, callback) ->
		@_nanoReader.head id, (err, _, headers) ->
			return callback and callback err if err
			rev = headers.etag.substr(1, headers.etag.length - 2)
			return callback and callback null, rev

	destroy: (model, id, callback) ->
		debug 'CouchDB destroy'
		@getLatestRevision model, id, (err, rev) =>
			return callback and callback err if err
			@_nanoWriter.destroy id, rev, (err, rsp) =>
				return callback and callback err, rsp

	findById: (model, id, callback) ->
		debug 'CouchDB findById'
		@_nanoReader.get id, (err, doc) =>
			debug err, doc
			return callback and callback null, [] if err and err.statusCode is 404
			return callback and callback err if err
			return callback and callback null, [(@fromDB model, doc)]	# Uses array as this function is called by all who needs to return array

	viewFunction: (model, ddoc, viewname, keys, callback) ->
		ddoc = if ddoc then ddoc else @settings.database or @settings.db
		view = _.findWhere @_availableViews, {ddoc: ddoc, name: viewname}
		
		if not view
			return callback and callback "The requested view is not available in the datasource"
		params = keys
		if typeof keys is 'function'
			callback = keys
			params = {}
		if typeof keys is 'string'
			params = keys: [keys]
		if _.isArray keys
			params = keys: keys

		
		debug model, ddoc, viewname, params
		
		@_nanoReader.view ddoc, viewname, params, (err, rsp) =>
			return callback and callback err if err
			docs = _.pluck rsp.rows, 'value'
			return callback and callback null, (@fromDB model, doc for doc in docs)

	buildViewEndpoint: (views) ->
		@_availableViews = views
		fn = _.bind @viewFunction, @
		fn.accepts = [
			{
				arg: 'modelName'
				type: "string"
				description: "The current model name"
				required: false
				http: (ctx) ->
					return ctx.method.sharedClass.name
			},
			{ arg: 'ddoc', type: "string", description: "The design document name for the requested view. Defaults to CouchDB database name used for this data.", required: false, http: {source: 'query'}},
			{ arg: 'viewname', type: "string", description: "The view name requested.", required: true, http: {source: 'query'}},
			{ arg: 'keys', type: "object", description: "The index(es) requested to narrow view results. Parameter can be a string, array of strings or object with 'key' or with 'startkey' and 'endkey', as per CouchDB. Use the object version for complex keys querying.", required: false, http: {source: 'query'}}
		]
		fn.returns = { arg: 'items', type: "array"}
		fn.shared = true
		fn.http =
			path: '/queryView',
			verb: 'get'
		fn.description = "Query a CouchDB view based on design document name, view name and keys."
		return fn
	
	buildAuthUrl: (auth) ->
		if auth and (auth.username or auth.user) and (auth.password or auth.pass)
			authString = (auth.username || auth.user) + ':' + (auth.password || auth.pass) + '@'
		else
			authString = ''
		url = @settings.protocol + '://' + authString + @settings.hostname + ':' + @settings.port + '/' + @settings.database
		return url


# helpers
helpers =
	optimizeSettings: (settings) ->
		settings.hostname = settings.hostname or settings.host or '127.0.0.1'
		settings.protocol = settings.protocol or 'http'
		settings.port = settings.port or 5984
		settings.database = settings.database or settings.db
		if (not settings.database)
			throw new Error("Database name must be specified in dataSource for CouchDB connector")
    
	merge: (base, update) ->
		return update unless base
		if not _.isArray base
			_.extend base, update
		else
			_.each base, (doc) ->
				_.extend doc, update
		base

	reverse: (key) ->
		if hasOrder = key.match(/\s+(A|DE)SC$/i)
			return -1 if hasOrder[1] is "DE"
		return 1

	stripOrder: (key) -> key.replace(/\s+(A|DE)SC/i, "")

	savePrep: (model, data) ->
		if id = data.id
			data._id = id.toString()
		delete data.id
		if data._rev is null
			delete data._rev
		if model
			data.loopbackModel = model
		return

	undoPrep: (data) ->
		if _id = data._id
			data.id = _id.toString()
		delete data._id
		delete data.loopbackModel
		return

	designName: (modelName) -> 'loopback_' + modelName

	viewName: (propName) -> 'by_' + propName

	invokeCallbackOrLogError: (callback, err, res) ->
		# When callback exists let it handle the error and result
		if callback
			callback and callback err, res
		else if err
			# Without a callback we can at least log the error
			console.log err
  
	updateDesign: (db, designName, design, callback) ->
		# Add the design document to the database or update it if it already exists.
		db.get designName, (err, designDoc) =>
			if err && err.error != 'not_found'
				return helpers.invokeCallbackOrLogError callback, err, designDoc

			# Update the design doc
			if !designDoc
				designDoc = design
			else
				# We only update the design when its views have changed - this avoids rebuilding the views.
				if _.isEqual(designDoc.views, design.views)
					return helpers.invokeCallbackOrLogError callback, null, designDoc
				designDoc.views = design.views

			# Insert the design doc into the database.
			db.insert designDoc, designName, (err, insertedDoc) =>
				return helpers.invokeCallbackOrLogError callback, err, insertedDoc


