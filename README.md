# Jinaga

Application-agnostic back end for web applications.

Add Jinaga.JS to a React app to manage application state.
Point it to a Jinaga back end and it will persist that state to the server.

## Install

Install Jinaga.JS from the NPM package.

```bash
npm i jinaga
```

This installs both the client side and server side components.
See [jinaga.com](https://jinaga.com) for details on how to use them.

## Build

To build Jinaga.JS, you will need Node 16.

```bash
npm ci
npm run build
npm test
```

## Changes in version 3

In version 3 of Jinaga.JS, the `has` function takes two parameters.
The second is the name of the predecessor type.
In version 2, the function took only one parameter: the field name.

To upgrade, change this:

```javascript
function assignmentUser(assignment) {
  ensure(assignment).has("user");
  return j.match(assignment.user);
}
```

To this:

```javascript
function assignmentUser(assignment) {
  ensure(assignment).has("user", "Jinaga.User");
  return j.match(assignment.user);
}
```

## Running a Database in a Docker Container

The Jinaga server stores its data in a PostgreSQL database.
The easiest way to get a database up and running is to start a Docker container.

```bash
docker run --name jinaga-postgres -p5432:5432 -e POSTGRES_PASSWORD=secretpw -e APP_USERNAME=appuser -e APP_PASSWORD=apppw -e APP_DATABASE=appdb jinaga/jinaga-postgres-fact-keystore
```

## Installing a Database

If you are running Postgres yourself, you can create a Jinaga database on your server.
The setup script is written for Linux.
To run the script, make sure you have the `psql` command [installed](https://www.postgresql.org/download/).
To check, run:

```bash
psql --version
```

If you don't have `psql` installed, install it:

```bash
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
sudo apt-get update
sudo apt-get install postgresql-client
```

Then run the setup script.
To create a new database, you will need to know the following information about your PostgreSQL installation:

- Host name
- Port (probably 5432)
- Admin user name (probably postgres)
- Admin database name (also probably postgres)
- Admin password

Then you will need to decide on the following:

- Application user name
- Application database name
- Application password

Once you have those values, set some environment variables and run the script:

```bash
export JINAGA_POSTGRES_HOST="localhost"
export JINAGA_POSTGRES_PORT="5432"
export JINAGA_POSTGRES_ADMIN_USER="postgres"
export JINAGA_POSTGRES_ADMIN_DATABASE="postgres"
export JINAGA_POSTGRES_ADMIN_PASSWORD="$ecr3t"
export JINAGA_POSTGRES_APP_USER="appuser"
export JINAGA_POSTGRES_APP_DATABASE="appdb"
export JINAGA_POSTGRES_APP_PASSWORD="apppw"

./setup.sh
```

## Migrating from version 2

If you are already running a Jinaga database, whether in a container or on your own PostgreSQL server, you will need to upgrade to get it to work with version 3.
The Jinaga server version 2 used a less efficient database schema.
Run the setup script to upgrade the database schema.

Your data is moved to a new Postgres schema called `legacy`.
It is not modified during the process.
Nevertheless, it would be wise to back up your database before running this operation.

The upgrade script is written for Linux.
To run the upgrade, make sure you have the `psql` command [installed](https://www.postgresql.org/download/).
To check, run:

```bash
psql --version
```

If you don't have `psql` installed, install it:

```bash
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
sudo apt-get update
sudo apt-get install postgresql-client
```

Then run the upgrade script.
To upgrade, you will need to know the following information about your PostgreSQL installation:

- Host name
- Port (probably 5432)
- Admin user name (probably postgres)
- Admin database name (also probably postgres)
- Admin password
- Application user name
- Application database name
- Application password

Once you have those values, set some environment variables and run the script:

```bash
export JINAGA_POSTGRES_HOST="localhost"
export JINAGA_POSTGRES_PORT="5432"
export JINAGA_POSTGRES_ADMIN_USER="postgres"
export JINAGA_POSTGRES_ADMIN_DATABASE="postgres"
export JINAGA_POSTGRES_ADMIN_PASSWORD="$ecr3t"
export JINAGA_POSTGRES_APP_USER="appuser"
export JINAGA_POSTGRES_APP_DATABASE="appdb"
export JINAGA_POSTGRES_APP_PASSWORD="apppw"

./upgrade.sh
```
