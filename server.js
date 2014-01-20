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


app.use(function (req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With, X-PINGOTHER');
    res.header('Access-Control-Allow-Credentials', 'true');
    next();
});


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


sockjs_server.on('connection', function(socket) {
    sockjs_server.write_all('New client connected, with id: ' + socket.id);

    socket.on('close', function() {
        fmt_log("inside socket.on 'close' callback", true);
    });

    socket.on('successfully-connnected', function(data) {
        fmt_log("inside socket.on 'successfully-connected' callback, data: " + JSON.stringify(data), true);
    });

    socket.on('subscribe-to-updates', function(data) {
        fmt_log("inside socket.on 'subscribe-to-updates' callback, data: " + JSON.stringify(data), true);
        fmt_log('socket id: ' + socket.id, false, false, true);

        socket.join(data.room_id);
    });

    socket.on('submitted-game-action', function(data) {
        console.log('\n====================')
        fmt_log("inside socket.on 'sumbitted-game-action' callback, data: " + JSON.stringify(data), true);
        fmt_log('socket id: ' + socket.id, false, false, true);

        data.initiator_id = socket.id;
        event_manager.sync(data.move_id, data)
    });

    socket.on('received-game-update', function(data) {
        fmt_log("inside socket.on 'recieved-game-update' callback, data: " + JSON.stringify(data), true);
        fmt_log('socket id: ' + socket.id, false, false, true);

        event_manager.clear(data.event_id);
    });

    socket.on('submitted-undo-request', function(data) {
        console.log('\n====================');
        fmt_log("inside socket.on 'sumbitted-undo-request' callback, data: " + JSON.stringify(data), true);
        fmt_log('socket id: ' + socket.id, false, false, true);

        data.initiator_id = socket.id;
        event_manager.sync(data.request_id, data);
    });

    socket.on('undo-performed', function(data) {
        console.log('\n====================');
        fmt_log("inside socket.on 'undo-performed' callback, data: " + JSON.stringify(data), true);
        fmt_log('socket id: ' + socket.id, false, false, true);

        data.initiator_id = socket.id;
        event_manager.sync(data.event_id, data);
    });

    socket.on('received-undo-request', function(data) {
        fmt_log("inside socket.on 'recieved-undo-request' callback, data: " + JSON.stringify(data), true);
        fmt_log('socket id: ' + socket.id, false, false, true);

        event_manager.clear(data.request_id);
    });
});


redis.on('message' , function(channel, json_data) {
    console.log('\n====================');
    fmt_log("inside redis.on('message', cb) callback", true);
    fmt_log("channel: " + channel + ", json_data: " + json_data, false, false, true);

    var data = JSON.parse(json_data);
    data.from = 'redis';

    if (data.event_type == 'game-update') {
        data.event_name = data.event_type;
        delete data.event_type;

        event_manager.sync(data.event_id, data);
    }
    else if (data.event_type == 'undo-request') {
        data.event_name = data.event_type;
        delete data.event_type;

        event_manager.sync(data.request_id, data);
    }
});
redis.subscribe('game-events');


var EventManager = function() {
    var events = {};

    this.sync = function(event_id, data) {
        var keys_str = ', data.keys: ' + JSON.stringify(Object.keys(data));
        fmt_log('event_manager.sync -- event_id: ' + event_id + keys_str + ', from: ' + data.from, false, false, true);
        if (!has_key(events, event_id)) {
            events[event_id] = new EventHandler(event_id);
        }
        handler = events[event_id];

        if (has_key(data, 'initiator_id'))
            handler.set_initiator(data.initiator_id);
        if (has_key(data, 'payload'))
            handler.set_data(data);
        fmt_log('event_manager, remaining event_ids: ' + JSON.stringify(Object.keys(events)), false, false, true);
    }

    this.clear = function(event_id) {
        if (has_key(events, event_id)) {
            delete events[event_id];
        } else fmt_log('event_manager.clear -- event_id was not found', true);

        var event_ids = JSON.stringify(Object.keys(events));
        fmt_log('event_manager.clear -- event_id: ' + event_id + ', remaining event_ids: ' + event_ids, true);
    }
}
var event_manager = new EventManager;

var EventHandler = function(event_id) {
    var event_data = {};
    var event_id = event_id;
    var initiator_id = null;

    var received_event_data = false;
    var initiator_identified = false;
    var that = this;

    this.set_data = function(data) {
        for(var data_key in data) event_data[data_key] = data[data_key];
        var keys = JSON.stringify(Object.keys(event_data));
        fmt_log('EventHandler.set_data -- event_data.keys: ' + keys, false, false, true);

        received_event_data = true;
        if (that.ready_to_send) send_data();
    };

    this.set_initiator = function(_initiator_id) {
        initiator_id = _initiator_id;
        initiator_identified = true;

        if (that.ready_to_send) send_data();
    };

    var send_data = function() {
        log_msg = 'event_id: ' + event_id + ', event_name: ' + event_data.event_name;
        fmt_log('EventHandler.send_data -- ' + log_msg, false, false, true);
        fmt_log('event_data: ' + JSON.stringify(event_data), false, false, true);

        // the 'skip' option allows us to not send event data to the initiator of the event
        // users are identified by socket id, which we get automatically with SockJS
        options = { skip: [initiator_id] };
        fmt_log("sending event_data via '" + event_data.event_name + "'",  false, false, true);
        var payload = event_data.payload;
        payload.event_id = event_id;
        sockjs_server.rooms(event_data.room_id).emit(event_data.event_name, payload, options);
    };

    Object.defineProperty(this, 'ready_to_send', {
        get: function() { return (initiator_identified && received_event_data); }
    });
}

