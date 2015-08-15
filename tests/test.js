'use strict';

var _ = require('lodash');
var http = require('http');
var expect = require('expect.js');
var request = require('superagent-bluebird-promise');
var express = require('express');
var objection = require('objection');
var bodyParser = require('body-parser');

var testUtils = require('./utils');
var objectionRestGenerator = require('../objection-rest');

describe('integration tests', function () {

  var numPersons = 10;
  var numAnimalsPerPerson = 10;
  var numMoviesPerPerson = 10;

  _.each(testUtils.testDatabaseConfigs, function (knexConfig) {

    describe(knexConfig.client, function() {
      var session, knex, Person, Animal, Movie, server;

      before(function () {
        session = testUtils.initialize(knexConfig);
        knex = session.knex;
        Person = session.models.Person;
        Animal = session.models.Animal;
        Movie = session.models.Movie;
      });

      before(function () {
        return testUtils.dropDb(session);
      });

      before(function () {
        return testUtils.createDb(session);
      });

      beforeEach(function () {
        return testUtils.truncateDb(session);
      });

      /**
       * Insert the test data.
       *
       * 10 Persons with names `F00 L09`, `F01 L08`, ...
       *   The previous person is the parent of the next one (the first person doesn't have a parent).
       *
       *   Each person has 10 Pets `P00`, `P01`, `P02`, ...
       *     First person has pets 0 - 9, second 10 - 19 etc.
       *
       *   Each person is an actor in 10 Movies `M00`, `M01`, `M02`, ...
       *     First person has movies 0 - 9, second 10 - 19 etc.
       *
       * name    | parent  | pets      | movies
       * --------+---------+-----------+----------
       * F00 L09 | null    | P00 - P09 | M99 - M90
       * F01 L08 | F00 L09 | P10 - P19 | M89 - M80
       * F02 L07 | F01 L08 | P20 - P29 | M79 - M79
       * F03 L06 | F02 L07 | P30 - P39 | M69 - M60
       * F04 L05 | F03 L06 | P40 - P49 | M59 - M50
       * F05 L04 | F04 L05 | P50 - P59 | M49 - M40
       * F06 L03 | F05 L04 | P60 - P69 | M39 - M30
       * F07 L02 | F06 L03 | P70 - P79 | M29 - M20
       * F08 L01 | F07 L02 | P80 - P89 | M19 - M10
       * F09 L00 | F08 L01 | P90 - P99 | M09 - M00
       */
      beforeEach(function () {
        return testUtils.insertData(session, {
          persons: numPersons,
          pets: numAnimalsPerPerson,
          movies: numMoviesPerPerson
        });
      });

      describe('default settings', function () {

        before(function (done) {
          var app = express().use(bodyParser.json());

          objectionRestGenerator(objection)
            //.logger(console.log.bind(console))
            .addModel(Person)
            .addModel(Movie)
            .addModel(Animal)
            .generate(app);

          server = http.createServer(app);
          server.listen(3564, null, function () {
            done();
          });
        });

        after(function (done) {
          server.close(function () {
            done();
          });
        });

        describe('GET /persons', function () {

          it('should get all persons', function () {
            return request
              .get('http://localhost:3564/persons')
              .then(function (res) {
                expect(res.status).to.equal(200);
                expect(res.body).to.have.length(numPersons);
              });
          });

          it('should get a subset with filters', function () {
            return request
              .get('http://localhost:3564/persons')
              .query({
                "firstName:like": "F%",
                "pets.name:lt": "P80",
                "movies.name:gte": "M19",
                "movies.name:lt": "M60",
                "orderBy": 'parent.lastName',
                "eager": 'parent',
                "rangeStart": 2,
                "rangeEnd": 4
              })
              .then(function (res) {
                expect(res.status).to.equal(200);
                expect(res.body.total).to.equal(4);
                expect(_.pluck(res.body.results, 'lastName')).to.eql([/*'L02', 'L03', */'L04', 'L05']);
                expect(_.pluck(res.body.results, 'parent.lastName')).to.eql([/*'L03', 'L04', */'L05', 'L06']);
              });
          });

        });

        describe('GET /persons/:id', function () {

          it('should get one person', function () {
            return request
              .get('http://localhost:3564/persons/5')
              .then(function (res) {
                expect(res.status).to.equal(200);
                expect(res.body.id).to.eql(5);
                expect(res.body.firstName).to.equal('F04');
              });
          });

          it('should get relations eagerly', function () {
            return request
              .get('http://localhost:3564/persons/5')
              .query({eager: '[pets, movies]'})
              .then(function (res) {
                expect(res.status).to.equal(200);
                expect(res.body.id).to.eql(5);
                expect(res.body.firstName).to.equal('F04');
                expect(res.body.pets).to.have.length(numAnimalsPerPerson);
                expect(res.body.movies).to.have.length(numMoviesPerPerson);
              });
          });

        });

        describe('POST /persons', function () {

          it('should insert a new person', function () {
            return request
              .post('http://localhost:3564/persons')
              .send({firstName: 'A', lastName: 'B'})
              .then(function (res) {
                expect(res.status).to.equal(200);
                expect(res.body).to.eql({firstName: 'A', lastName: 'B', pid: null, id: numPersons + 1, age: null});
                return session.knex('Person');
              })
              .then(function (rows) {
                expect(rows).to.have.length(numPersons + 1);
                expect(_.where(rows, {firstName: 'A', lastName: 'B'})).to.have.length(1);
              });
          });

        });

        describe('PUT /persons/:id', function () {

          it('should update a person', function () {
            return request
              .put('http://localhost:3564/persons/6')
              .send({firstName: 'A', lastName: 'B', age: 666})
              .then(function (res) {
                expect(res.status).to.equal(200);
                expect(res.body).to.eql({firstName: 'A', lastName: 'B', pid: 5, id: 6, age: 666});
                return session.knex('Person');
              })
              .then(function (rows) {
                expect(rows).to.have.length(numPersons);
                expect(_.where(rows, {firstName: 'A', lastName: 'B', age: 666})).to.have.length(1);
              });
          });

          it('should get relations eagerly for the updated model', function () {
            return request
              .put('http://localhost:3564/persons/6')
              .query({eager: 'parent'})
              .send({firstName: 'A', lastName: 'B', age: 666})
              .then(function (res) {
                expect(res.status).to.equal(200);
                expect(_.pick(res.body, 'firstName', 'lastName', 'age')).to.eql({
                  firstName: 'A',
                  lastName: 'B',
                  age: 666
                });
                expect(res.body.parent.id).to.eql(5);
                return session.knex('Person');
              })
              .then(function (rows) {
                expect(rows).to.have.length(numPersons);
                expect(_.where(rows, {firstName: 'A', lastName: 'B', age: 666})).to.have.length(1);
              });
          });

        });

        describe('PATCH /persons/:id', function () {

          it('should patch a person', function () {
            return request
              .patch('http://localhost:3564/persons/6')
              .send({age: 666})
              .then(function (res) {
                expect(res.status).to.equal(200);
                expect(res.body).to.eql({firstName: 'F05', lastName: 'L04', pid: 5, id: 6, age: 666});
                return session.knex('Person');
              })
              .then(function (rows) {
                expect(rows).to.have.length(numPersons);
                expect(_.where(rows, {firstName: 'F05', lastName: 'L04', age: 666})).to.have.length(1);
              });
          });

          it('should get relations eagerly for the patched model', function () {
            return request
              .patch('http://localhost:3564/persons/6')
              .query({eager: 'parent'})
              .send({age: 777})
              .then(function (res) {
                expect(res.status).to.equal(200);
                expect(_.pick(res.body, 'firstName', 'lastName', 'age')).to.eql({
                  firstName: 'F05',
                  lastName: 'L04',
                  age: 777
                });
                expect(res.body.parent.id).to.eql(5);
                return session.knex('Person');
              })
              .then(function (rows) {
                expect(rows).to.have.length(numPersons);
                expect(_.where(rows, {firstName: 'F05', lastName: 'L04', age: 777})).to.have.length(1);
              });
          });

        });

        describe('DELETE /persons/:id', function () {

          it('should delete a person', function () {
            return request
              .del('http://localhost:3564/persons/6')
              .then(function (res) {
                expect(res.status).to.equal(200);
                expect(res.body).to.eql({});
                return session.knex('Person');
              })
              .then(function (rows) {
                expect(rows).to.have.length(numPersons - 1);
                expect(_.where(rows, {firstName: 'F05', lastName: 'L04'})).to.have.length(0);
              });
          });

        });

        describe('POST /persons/:id/parent', function () {

          it('should create and set the parent relation', function () {
            return request
              .post('http://localhost:3564/persons/4/parent')
              .send({firstName: 'New', lastName: 'Person', age: 123})
              .then(function (res) {
                expect(res.status).to.equal(200);
                expect(res.body).to.eql({id: numPersons + 1, firstName: 'New', lastName: 'Person', age: 123, pid: null});
                return session.knex('Person');
              })
              .then(function (rows) {
                expect(rows).to.have.length(numPersons + 1);
                expect(_.where(rows, {firstName: 'New', lastName: 'Person'})).to.have.length(1);
                expect(_.find(rows, {id: _.isString(rows[0].id) ? '4' : 4}).pid).to.eql(numPersons + 1);
              });
          });

        });

        describe('GET /persons/:id/parent', function () {

          it('should return the parent relation', function () {
            return request
              .get('http://localhost:3564/persons/4/parent')
              .then(function (res) {
                expect(res.status).to.equal(200);
                expect(_.pick(res.body, 'firstName', 'id')).to.eql({id: 3, firstName: 'F02'});
              })
          });

        });

        describe('POST /persons/:id/pets', function () {

          it('should add new pet for a person', function () {
            return request
              .post('http://localhost:3564/persons/4/pets')
              .send({name: 'New pet'})
              .then(function (res) {
                expect(res.status).to.equal(200);
                expect(_.pick(res.body, 'name')).to.eql({name: 'New pet'});
                return session.knex('Animal');
              })
              .then(function (rows) {
                expect(rows).to.have.length(numPersons * numAnimalsPerPerson + 1);
                expect(_.find(rows, {name: 'New pet'}).ownerId).to.eql(4);
              });
          });

        });

        describe('GET /persons/:id/pets', function () {

          it('should return the pets relation', function () {
            return request
              .get('http://localhost:3564/persons/4/pets')
              .query({orderByDesc: 'name'})
              .then(function (res) {
                expect(res.status).to.equal(200);
                expect(_.pluck(res.body, 'name')).to.eql(['P39', 'P38', 'P37', 'P36', 'P35', 'P34', 'P33', 'P32', 'P31', 'P30']);
              });
          });

          it('should get a subset with filters', function () {
            return request
              .get('http://localhost:3564/persons/4/pets')
              .query({
                'orderByDesc': 'name',
                'name:lte': 'P37',
                'name:gte': 'P34',
                'rangeStart': 1,
                'rangeEnd': 2
              })
              .then(function (res) {
                expect(res.status).to.equal(200);
                expect(_.pluck(res.body.results, 'name')).to.eql(['P36', 'P35']);
                expect(res.body.total).to.equal(4);
              });
          });

        });

        describe('POST /persons/:id/movies', function () {

          it('should add new movie for a person', function () {
            return request
              .post('http://localhost:3564/persons/4/movies')
              .send({name: 'New movie'})
              .then(function (res) {
                expect(res.status).to.equal(200);
                expect(_.pick(res.body, 'name')).to.eql({name: 'New movie'});
                return [session.knex('Movie'), res.body.id];
              })
              .spread(function (rows, newId) {
                expect(rows).to.have.length(numPersons * numMoviesPerPerson + 1);
                expect(_.where(rows, {name: 'New movie', id: newId})).to.have.length(1);
                return [session.knex('Person_Movie'), newId];
              })
              .spread(function (rows, newId) {
                var personId = _.isString(newId) ? '4' : 4;
                expect(rows).to.have.length(numPersons * numMoviesPerPerson + 1);
                expect(_.where(rows, {actorId: personId, movieId: newId})).to.have.length(1);
              });
          });

        });


        describe('GET /persons/:id/movies', function () {

          it('should return the movies relation', function () {
            return request
              .get('http://localhost:3564/persons/7/movies')
              .query({orderByDesc: 'name'})
              .then(function (res) {
                expect(res.status).to.equal(200);
                expect(_.pluck(res.body, 'name')).to.eql(['M39', 'M38', 'M37', 'M36', 'M35', 'M34', 'M33', 'M32', 'M31', 'M30']);
              });
          });

          it('should get a subset with filters', function () {
            return request
              .get('http://localhost:3564/persons/7/movies')
              .query({
                'orderByDesc': 'name',
                'name:lte': 'M37',
                'name:gte': 'M34',
                'rangeStart': 1,
                'rangeEnd': 2
              })
              .then(function (res) {
                expect(res.status).to.equal(200);
                expect(_.pluck(res.body.results, 'name')).to.eql(['M36', 'M35']);
                expect(res.body.total).to.equal(4);
              });
          });

        });

      });

    });

  });

});
