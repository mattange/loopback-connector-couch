## loopback-connector-couch

CouchDB connector for Loopback.io. 
Heavily borrowing from the original CouchDB-nano adapter for jugglingdb by Nicholas Westlake and Anatoliy Chakkaev, but adapted/partially rewritten for use with Loopback.io.
You need to have CoffeeScript if you want to adapt it. 

## Compilation
Use `grunt` to produce end file in `./lib`. Else, use directly the provided version or modify Gruntfile as you need.

## Working with your database
Upon initialisation, you can specify different authorisations, and up to 3 different connections will be established to the database: one for reader, one for writer and one for admin (see below why you need an admin one).

## Usage

To use it you need to load the loopback-connector-juggler first if used programmatically, as any other connector.
Otherwise, set things up in your datasources.json (see Loopback.io documentation for details):

```   	
"YOURDATASOURCENAME": {
	"name": "YOURDATASOURCENAME",	//Loopback.io - mandatory
	"connector": "couch",			//Loopback.io - mandatory
	"db": "DBNAME",					//"db" or "database" - required
	"host": "127.0.0.1",			//this is also the default if not included
	"port": 5984,					//this is also the default if not included
	"protocol": "http",				//this is also the default if not included
	"auth": {						//optional, including each of its members
			"admin": {
				"username": "YOURUSERNAME_ADMIN",
				"password": "YOURPASSWORD_ADMIN"
			},
			"reader": {
				"username": "YOURUSERNAME_READER",
				"password": "YOURPASSWORD_READER"
			},
			"writer": {
				"username": "YOURUSERNAME_WRITER",
				"password": "YOURPASSWORD_WRITER"
			}
	},
	"views": [						//optional
		{
			"ddoc": "existing_design_document",
			"name": "existing_design_document_view"
		},
		...
	]
}
```
    
### Automatic creation of views for indexes

This adapter will automatically a number of design documents on your database:
 1. `\_design/loopback` document contains `by_model` view that maps documents to their model name (set as property in the model as "loopbackModel"). To do so, authorisation enabled to modify design documents is required in the parameters if the CouchDB server is not in party mode.
 2. For each model that has at least one property with `index: true` it will create one design document named `\_design/loopback_<modelName>` and one view named `by_<propertyName>` for each indexed property. Again, authorisation enabled to modify design documents is required.
 3. Additional views can be queried if appropriately set up at initialization in the `views` option. 

### Automatic use of created views

During querying of database for standard Loopback.io API endpoints this adapter will:
 1. Try to automatically leverage the views it created if an indexed property is used in `where`.
 2. Fallback to using `loopback/by_model` view to reduce the number of documents it has to load and scan.

### Query parameters and other details

- All queries to the database use `include_docs` set to `true`
- Loopback's `offset` is used as `skip` query parameter 
- Loopback's `limit` is used as `limit` query parameter
- Both `offset` and `limit` are ignored in the request if a specific `id` is requested via `where` (e.g. `{"where": {"id":"someID"}}`). If `where` is included (e.g. `{"where":{"foo":"bar"}}`), then the results are retrieved in their entirety, then filtered via `where` and then `offset` and `limit`, so that for example all items that satisfy the `where` criteria can be retrieved in various paginated requests.

## Known caveats

- `queryView` API endpoint (only generated if the options specify additional views to be made available in the CouchDB database) will return the output of the view (with specific keys as requested), that may or may not be linked to the Model being used for the query, if the same CouchDB database is used for multiple document types: fundamentally, no checks are done on the output of the view (other than any _id into id and removing loopbackModel property in case present).
- `PUT /modelName/{id} | updateAttributes` API endpoint will work as expected, but will not return the updated `_rev` (working to solve that issue). Consider updating the entire document via `PUT /modelName`, as that will allow to update the `_rev` in the response.

## MIT License

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in
    all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
    THE SOFTWARE.

