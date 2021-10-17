import { expect } from "chai";
import { Jinaga, ensure } from "../../src/jinaga";
import { MemoryStore } from "../../src/memory/memory-store";
import { MockAuthentication } from "./mock-authentication";

class Room {
    type: string;
    identifier: number;
}

class Message {
    type: string;
    room: Room;
    sender: Person;
}

class Removed {
    type: string;
    message: Message;
}

class Person {
    type: string;
    identifier: number;
}

class Name {
    type: string;
    person: Person;
    value: string;
    prior: Name[];
}

class MessageViewModel {
    constructor(
        public message: Message,
        public from: string[]
    ) { }
}


describe("Nested watch", function () {
    var j: Jinaga;
    var room: Room;
    var messageViewModels: MessageViewModel[];

    beforeEach(function () {
        const memory = new MemoryStore();
        j = new Jinaga(new MockAuthentication(memory), memory, null);
        room = {
            type: 'Room',
            identifier: Math.random()
        };
        messageViewModels = [];
    });

    function messageRemoved(m: Message) {
        return j.exists<Removed>({
            type: 'Removed',
            message: m
        });
    }

    function messagesInRoom(r: Room) {
        return j.match<Message>({
            type: 'Message',
            room: r
        }).suchThat(j.not(messageRemoved));
    }

    function nameIsCurrent(n: Name) {
        return j.notExists<Name>({
            type: 'Name',
            prior: [n]
        });
    }

    function namesOfSender(m: Message) {
        ensure(m).has("sender");
        m.sender.type = 'Person';
        return j.match<Name>({
            type: 'Name',
            person: m.sender
        }).suchThat(nameIsCurrent);
    }

    function makeMessageViewModel(message: Message) {
        const vm = new MessageViewModel(message, []);
        messageViewModels.push(vm);
        //console.log('-- Received message: ' + JSON.stringify(message));
        return vm;
    }

    function removeMessageViewModel(vm: MessageViewModel) {
        //console.log('-- Removed message: ' + JSON.stringify(vm.message));
        const index = messageViewModels.indexOf(vm);
        if (index >= 0) {
            messageViewModels.splice(index, 1);
        }
    }

    function setMessageFrom(vm: MessageViewModel, name: Name) {
        // console.log('-- Set name for ' + JSON.stringify(vm) + ': ' + JSON.stringify(name));
        vm.from.push(name.value);
        return {
            vm: vm,
            prior: name.value
        };
    }

    function removeMessageFrom(setting: {vm: MessageViewModel, prior: string}) {
        const index = setting.vm.from.indexOf(setting.prior);
        if (index >= 0)
            setting.vm.from.splice(index, 1);
    }

    it("can be expressed", async function () {
        const watch = await startWatch();
        watch.stop();
    });

    it("should find existing fact", async function () {
        const person = await addPerson();
        await setName(person, 'George');
        await addMessage(person);
        const watch = await startWatch();
        expectName('George');

        watch.stop();
    });

    it("should find new facts", async function () {
        const watch = await startWatch();
        const person = await addPerson();
        await setName(person, 'George');
        await addMessage(person);
        expectName('George');

        watch.stop();
    });

    it("should find new facts in other order", async function () {
        const watch = await startWatch();
        const person = await addPerson();
        await addMessage(person);
        await setName(person, 'George');
        expectName('George');

        watch.stop();
    });

    it("should not find facts after stopped", async function () {
        const watch = await startWatch();
        const person = await addPerson();
        await addMessage(person);
        watch.stop();
        await setName(person, 'George');
        expectName(undefined);
    });

    it("should stop child", async function () {
        const messages = j.watch(room, j.for(messagesInRoom), makeMessageViewModel, vm => {});
        await messages.load();
        const names = messages.watch(j.for(namesOfSender), setMessageFrom, removeMessageFrom);
        await names.load();
        names.stop();

        const person = await addPerson();
        await addMessage(person);
        await setName(person, 'George');
        expectName(undefined);

        messages.stop();
    });

    it("should remove messages", async function () {
        const person = await addPerson();
        await setName(person, 'George');
        const message = await addMessage(person);
        const watch = await startWatch();
        await removeMessage(message);
        expectNoMessages();

        watch.stop();
    });

    it("should replace names", async function () {
        const person = await addPerson();
        const name = await setName(person, 'George');
        await addMessage(person);
        const watch = await startWatch();
        await setName(person, 'John', [name]);
        expectName('John');

        watch.stop();
    })

    function addPerson() {
        return j.fact(<Person>{
            type: 'Person',
            identifier: Math.random()
        });
    }

    function setName(person: Person, value: string, prior: Name[] = []) {
        return j.fact(<Name>{
            type: 'Name',
            person: person,
            value: value,
            prior: prior
        });
    }

    function addMessage(person: Person) {
        return j.fact(<Message>{
            type: 'Message',
            room: room,
            sender: person,
            identifier: Math.random()
        });
    }

    function removeMessage(message: Message) {
        return j.fact(<Removed>{
            type: 'Removed',
            message: message
        });
    }

    async function startWatch() {
        const messages = j.watch(room, j.for(messagesInRoom), makeMessageViewModel, removeMessageViewModel);
        messages.watch(j.for(namesOfSender), setMessageFrom, removeMessageFrom);
        await messages.load();
        return messages;
    }

    function expectName(name: string) {
        expect(messageViewModels.length).to.equal(1);
        if (name) {
            expect(messageViewModels[0].from.length).to.equal(1);
            expect(messageViewModels[0].from[0]).to.equal(name);
        }
        else {
            expect(messageViewModels[0].from.length).to.equal(0);
        }
    }

    function expectNoMessages() {
        expect(messageViewModels.length).to.equal(0);
    }
});