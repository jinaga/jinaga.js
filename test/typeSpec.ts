import { JinagaBrowser } from '../src/jinaga-browser';

// Just want to make sure this code compiles.

const j = JinagaBrowser.create({
  httpEndpoint: 'https://localhost:3000/jinaga'
});

(async () => {
    const company = await j.fact({
        type: 'ImprovingU.Company',
        name: 'Improving'
    });
});

function accessInCompany(c: any) {
  return j.match({
      type: 'ImprovingU.Catalog.Access',
      write: {
          type: "ImprovingU.Catalog",
          _in: {
              type: "ImprovingU.Semester",
              _in: c
          }
      }
  });
}

function userForAccess(a: any) {
  a.has('to');
  return a.to;
}

function addTo(observableArray: any, map?: any) {
  map = map || function (o: any) { return o; };
  return function (fact: any) {
      var obj = map(fact);
      observableArray.push(obj);
      return obj;
  };
}

class  CoordinatorViewModel {
  constructor(coordinator: any) {

  }
}

function removeFrom(observableArray: any) {
    return function (obj: any) {
        if (obj.dispose)
            obj.dispose();
        observableArray.remove(obj);
    };
}

function namesForUser(u: any) {
  return j.match({
      type: 'UserName',
      from: u
  }).suchThat(nameIsCurrent);
}

function nameIsCurrent(n: any) {
  return j.notExists({
      type: 'UserName',
      prior: [n]
  });
}

function setValue(observable: any) {
    return (v: any) => {
        observable(v);
    }
}

function setChildValue(observableName: any) {
  return function (parent: any, v: any) {
      parent[observableName](v);
  }
}

export function watchSemester(viewModel: any, company: any, user: any, observable: any) {
    const nameWatch = j.watch(user, j.for(namesForUser), setValue(observable));
    var coordinatorsWatch = j.watch(company, j.for(accessInCompany).then(userForAccess),
        addTo(viewModel.coordinators, function (coordinator: any) { return new CoordinatorViewModel(coordinator); }),
        removeFrom(viewModel.coordinators));
    coordinatorsWatch.watch(j.for(namesForUser), setChildValue('nameFact'));
}

test("Types", () => {

})