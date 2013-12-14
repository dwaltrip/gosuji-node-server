var http = require('http'),
    express = require('express'),
    port = process.env.PORT || 5000,
    app = express(),
    server = http.createServer(app);

var utils = require('./utils');
var fmt_log = utils.fmt_log;
var has_key = utils.has_key;

console.log('==== ==== ==== ====');
console.log('---- port: ' + port);
console.log('==== ==== ==== ====');
server.listen(port);


// production
if (typeof process.env.REDISTOGO_URL !== 'undefined') {
    var redis_url = require('url').parse(process.env.REDISTOGO_URL);
    var redis = require('redis').createClient(redis_url.port, redis_url.hostname);
    redis.auth(redis_url.auth.split(':')[1]);
}
// development
else {
    var redis_url = require('url').parse(require('./development_config').REDISTOGO_URL);
    var redis = require('redis').createClient(redis_url.port, redis_url.hostname);
}
fmt_log('redis client -- domain: ' + redis.domain + ', host: ' + redis.host + ', port: ' + redis.port, true, true);


var SockjsServer = require('./SockjsServer').SockjsServer;
var sockjs_server = new SockjsServer(server, { prefix: '/realtime', verbose: true });

var update_handlers = {}

sockjs_server.on('connection', function(socket) {
    sockjs_server.write_all('New client connected, with id: ' + socket.id);

    socket.on('successfully-connnected', function(data) {
        fmt_log("inside socket.on 'successfully-connected' callback, data: " + JSON.stringify(data), true, true);
    });

    socket.on('subscribe-to-updates', function(data) {
        fmt_log("inside socket.on 'subscribe-to-updates' callback, data: " + JSON.stringify(data), true);
        fmt_log('socket id: ' + socket.id, false, true, true);

        socket.join(data.room_id);
    });

    socket.on('submitted-move', function(data) {
        fmt_log('\n====================\n', false, false, true);
        fmt_log("inside socket.on 'sumbitted-move' callback, data: " + JSON.stringify(data), true);

        fmt_log("-- Object.keys(update_handlers): " + JSON.stringify(Object.keys(update_handlers)), false, false, true);
        if(!has_key(update_handlers, data.move_id)) {
            update_handlers[data.move_id] = new UpdateHandler(data.move_id);
        }
        update_handlers[data.move_id].set_sender(socket.id);
    });

});


redis.on('message' , function(channel, json_data) {
    fmt_log("inside redis.on('message', cb) callback", true);
    fmt_log("channel: " + channel + ", json_data: " + json_data, false, false, true);

    var data = JSON.parse(json_data);
    //sockjs_server.rooms(data.room_id).emit('new-move', data, { skip: [data.from_id] });

    fmt_log("-- Object.keys(update_handlers): " + JSON.stringify(Object.keys(update_handlers)), true, false, true);
    if(!has_key(update_handlers, data.move_id)) {
        update_handlers[data.move_id] = new UpdateHandler(data.move_id);
    }

    fmt_log('-- update_handlers[data.move_id].sender_id): ' + update_handlers[data.move_id].sender_id, false, false, true);
    update_handlers[data.move_id].set_update_data(data);
});

redis.subscribe('game-updates');


var UpdateHandler = function(move_id) {
    this.update_data = {};
    this.sender_id = null;
    this.received_data_from_rails = false;
    this.move_id = move_id;

    var that = this;

    this.send_updates = function() {
        fmt_log("sending updates (move_id: " + that.move_id + ") -- update_data: " + JSON.stringify(that.update_data), false, true, true);
        sockjs_server.rooms(that.update_data.room_id).emit('new-move', that.update_data, { skip: [that.sender_id] });
    };

    this.set_update_data = function(data) {
        for(var data_key in data)
            that.update_data[data_key] = data[data_key];
        if (that.sender_id !== null)
            that.send_updates();
        that.received_data_from_rails = true;
    };

    this.set_sender = function(sender_id) {
        that.sender_id = sender_id;

        if (that.received_data_from_rails)
            that.send_updates();
    };
}

