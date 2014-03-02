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

        // clear references to now closed socket connection
        var dead_connection_id = null;
        for(var connection_id in socket_ids) {
            if (socket_ids[connection_id] == socket.id) {
                dead_connection_id = connection_id;
            }
        }
        if (dead_connection_id !== null) delete socket_ids[dead_connection_id];
        else fmt_log("---- UNEXPECTED, we couldn't find connection id for socket: " + socket.id, false, false, true);
    });

    socket.on('join-room', function(data) {
        fmt_log("inside socket.on 'join-room' callback, data: " + JSON.stringify(data), true);
        socket.join(data.room);
    });

    socket.on('successfully-connnected', function(data) {
        fmt_log("inside socket.on 'successfully-connected' callback, data: " + JSON.stringify(data), true);
        socket_ids[data.connection_id] = socket.id;
    });

    socket.on('chat-message', function(data) {
        fmt_log("inside socket.on 'chat-message' callback, data: " + JSON.stringify(data), true);
        sockjs_server.rooms(data.room_id).emit('chat-message', data, { skip: [socket.id] });
    });
});


redis.on('message' , function(channel, json_data) {
    console.log('\n====================');
    fmt_log("inside redis.on('message', cb) callback", true);
    fmt_log("channel: " + channel + ", json_data: " + json_data, false, false, true);

    var data = JSON.parse(json_data);
    send_socket_messages(data);
});
redis.subscribe('game-events');


function send_socket_messages(event_data) {
    var log_msg = 'event_name: ' + event_data.event_name;
    fmt_log('send_socket_messages -- ' + log_msg, false, false, true);
    fmt_log('event_data: ' + JSON.stringify(event_data), false, false, true);

    // the 'skip' option allows us to avoid sending event data to the initiator of the event
    // users are identified by socket id, which we get automatically with SockJS
    var options = { skip: [socket_ids[event_data.connection_id_to_skip]] };

    fmt_log("sending event_data via '" + event_data.event_name + "'",  false, false, true);
    sockjs_server.rooms(event_data.room_id).emit(event_data.event_name, event_data.payload, options);
}

var socket_ids = {}
