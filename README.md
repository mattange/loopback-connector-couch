## loopback-connector-couch

CouchDB connector for Loopback. Heavily borrowing from the original CouchDB-nano adapter for jugglingdb by Nicholas Westlake and Anatoliy Chakkaev, 
but adapted for use with Loopback.io. 

## Usage

To use it you need to load the loopback-connector-juggler first, as any
other connector.

Use:

    ```javascript

    ```

## Working with your database

### Automatic creation of views for indexes

This adapter will automatically create several design documents on your database:
 1. `\_design/loopback` document contains `by\_model` view that maps documents to their model name (set as property in the model as _loopbackModel). To do so, a special setting is required, that with authorisation to modify design documents.
 2. For each model that has at least one property with `indexed: true` it will create one design document named `\_design/loopback-<model name>` and one view named `by\_<property name>` for each indexed property.

### Automatic use of created views

During querying of database this adapter will:
 1. Try to automatically leverage the views it created if an indexed property is used in `where`.
 2. Fallback to using `nano/\_by_model` view to reduce the number of documents it has to load and scan.

### Query parameters

- All queries to the database use `include_docs` set to `true`
- Loopback's `offset` is used as `skip` query parameter
- Loopback's `limit` is used as `limit` query parameter

## Known issues

- jugglingdb's `findOne` (and methods that depend on it) has to be used only for keys with unique indexes as it passes `limit` of 1 to the adapter which then retrieves just the first document in the view which may or may not match the other `where` conditions.

## Running tests

Make sure you have couchdb server running on default port

    npm test

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

