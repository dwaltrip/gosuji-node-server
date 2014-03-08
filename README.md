# Node.js Server for GoSuji

This repository contains the code for the Node.js app that handles the realtime aspects of [GoSuji](https://github.com/dwaltrip/gosuji) (an app for playing the board game Go against others). Check out the live GoSuji app [here](http://gosuji.herokuapp.com/).

The Node.js app connects to an instance of Redis and then subscribes to a Redis channel. The Rails app powering GoSuji sends data to the Node.js through the channel, and [SockJS](https://github.com/sockjs/sockjs-node) websockets are used to send data to the necessary clients.

To making working with the websockets much easier, I created a [wrapper for SockJS](https://github.com/dwaltrip/sockjs-wrapper). This wrapper adds socket.io style named events and rooms.

See the [GoSuji readme](https://github.com/dwaltrip/gosuji#setting-up-and-running-gosuji-locally) for instructions on settting up and running the Node.js app locally.

## Notes

I haven't yet completely separated the SockJS wrapper out into its own stand-alone `npm` package yet, so currently the code is both a part of this repository and its own repository. Cleaning that up is in the works.
