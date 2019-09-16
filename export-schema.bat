mongodump -d dev -c pbserver__SCHEMA -o schema
bsondump --pretty schema/dev/pbserver__SCHEMA.bson > schema/schema.json
