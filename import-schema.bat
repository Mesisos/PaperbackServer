mongo --eval "db.getCollection('pbserver__SCHEMA').drop()" dev
mongorestore schema/
