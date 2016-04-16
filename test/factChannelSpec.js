var mocha = require('mocha');
var chai = require('chai');
var FactChannel = require('../node/factChannel');

var expect = chai.expect;

describe('FactChannel', function () {
    var messages;
    var channel;
    
    beforeEach(function () {
        messages = [];
        channel = new FactChannel(function (message) {
            messages.push(message);
        });
    });
    
    it('should serialize one fact', function () {
        channel.sendFact({
            type: "Jinaga.User",
            publicKey: "----BEGIN PUBLIC KEY---XXXXX"
        });
        
        expect(messages.length).to.equal(1);
        expect(messages[0]).to.eql({
            type: "fact",
            id: 1,
            fact:{
                type: "Jinaga.User",
                publicKey: "----BEGIN PUBLIC KEY---XXXXX"
            }
        });
    });
    
    it('should serialize a predecessor', function () {
        channel.sendFact({
            type: "List",
            name: "Chores",
            from: {
                type: "Jinaga.User",
                publicKey: "----BEGIN PUBLIC KEY---XXXXX"
            }
        });
        
        expect(messages.length).to.equal(2);
        expect(messages[0]).to.eql({
            type: "fact",
            id: 1,
            fact:{
                type: "Jinaga.User",
                publicKey: "----BEGIN PUBLIC KEY---XXXXX"
            }
        });
        expect(messages[1]).to.eql({
            type: "fact",
            id: 3,
            fact:{
                type: "List",
                name: "Chores",
                from: {
                    id: 1
                }
            }
        });
    });
});