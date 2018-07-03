module.exports = function() {
    'use strict';
    const WebSocket = require('ws');
    const pako = require('pako');
    const request = require('request');
    //const crypto = require('crypto');
    const file = require('fs');
    const url = require('url');
    const dns = require('dns-sync');
    const HttpsProxyAgent = require('https-proxy-agent');
    const SocksProxyAgent = require('socks-proxy-agent');
    const stringHash = require('string-hash');
    const base = 'https://api.huobi.pro/';
    const stream = 'wss://api.huobi.pro/ws/';
    const combineStream = 'wss://api.huobi.pro/ws/';
    const userAgent = 'Mozilla/4.0 (compatible; Node Binance API)';
    const contentType = 'application/x-www-form-urlencoded';
    let subscriptions = {};
    let depthCache = {};
    let depthCacheContext = {};

    const default_options = {
        recvWindow: 60000, // to be lowered to 5000 in v0.5
        useServerTime: false,
        reconnect: true,
        verbose: false,
        test: false,
        log: function(...args) {
            console.log(Array.prototype.slice.call(args));
        }
    };
    let options = default_options;
    let info = { timeOffset: 0 };
    let socketHeartbeatInterval;
     /**
     * Replaces socks connection uri hostname with IP address
     * @param {string} connString - socks conection string
     * @return {string} modified string with ip address
     */
    const proxyReplacewithIp = function(connString) {
      let arr = connString.split( '/' );
      let host = arr[2].split(':')[0];
      let port = arr[2].split(':')[1];
      return 'socks://' + dns.resolve(host) + ':' + port;
    }

    /**
     * returns an array in the form of [host, port]
     * @param {string} connString - conection string
     * @return {array} array of host and port
     */
    const parseProxy = function(connString) {
        let arr = connString.split( '/' );
        let host = arr[2].split(':')[0];
        let port = arr[2].split(':')[1];
        return [arr[0],host,port];
    }

    const addProxy = opt => {
      let socksproxy = process.env.socks_proxy || false;
      if ( socksproxy === false ) return opt;
      socksproxy = proxyReplacewithIp(socksproxy);

      if ( options.verbose ) options.log('using socks proxy server ' + socksproxy);

      opt.agentClass = SocksProxyAgent;
      opt.agentOptions = {
          protocol: parseProxy(socksproxy)[0],
          host: parseProxy(socksproxy)[1],
          port: parseProxy(socksproxy)[2]
      }
      return opt;
    }

    const reqHandler = cb => (error, response, body) => {
      if ( !cb ) return;

      if ( error ) return cb(error, {});

      if ( response && response.statusCode !== 200 ) return cb(response, {});

      return cb(null, JSON.parse(body));
    }

    const proxyRequest = (opt, cb) => request(addProxy(opt), reqHandler(cb));

    const reqObj = (url, data = {}, method = 'GET', key) => ({
      url: url,
      qs: data,
      method: method,
      timeout: options.recvWindow,
      headers: {
          'User-Agent': userAgent,
          'Content-type': contentType,
          'X-MBX-APIKEY': key || ''
      }
    })

    /**
     * Create a http request to the public API
     * @param {string} url - The http endpoint
     * @param {object} data - The data to send
     * @param {function} callback - The callback method to call
     * @param {string} method - the http method
     * @return {undefined}
     */
    const publicRequest = function(url, data = {}, callback, method = 'GET') {
        let opt = reqObj(url, data, method);
        proxyRequest(opt, callback);
    };

    /**
     * Create a http request to the public API
     * @param {string} url - The http endpoint
     * @param {object} data - The data to send
     * @param {function} callback - The callback method to call
     * @param {string} method - the http method
     * @return {undefined}
     */
    const apiRequest = function(url, data = {}, callback, method = 'GET') {
        if ( !options.APIKEY ) throw Error('apiRequest: Invalid API Key');
        let opt = reqObj(
          url,
          data,
          method,
          options.APIKEY
        );
        proxyRequest(opt, callback);
    };

    // /**
    //  * Make market request
    //  * @param {string} url - The http endpoint
    //  * @param {object} data - The data to send
    //  * @param {function} callback - The callback method to call
    //  * @param {string} method - the http method
    //  * @return {undefined}
    //  */
    // const marketRequest = function(url, data = {}, callback, method = 'GET') {
    //     if ( !options.APIKEY ) throw Error('apiRequest: Invalid API Key');
    //     let query = Object.keys(data).reduce(function(a,k){a.push(k+'='+encodeURIComponent(data[k]));return a},[]).join('&');
    //
    //     let opt = reqObj(
    //       url+(query ? '?'+query : ''),
    //       data,
    //       method,
    //       options.APIKEY
    //     );
    //     proxyRequest(opt, callback);
    // };

    /**
     * Create a signed http request to the signed API
     * @param {string} url - The http endpoint
     * @param {object} data - The data to send
     * @param {function} callback - The callback method to call
     * @param {string} method - the http method
     * @return {undefined}
     */
    // const signedRequest = function(url, data = {}, callback, method = 'GET') {
    //     if ( !options.APIKEY ) throw Error('apiRequest: Invalid API Key');
    //     if ( !options.APISECRET ) throw Error('signedRequest: Invalid API Secret');
    //     data.timestamp = new Date().getTime() + info.timeOffset;
    //     if ( typeof data.recvWindow === 'undefined' ) data.recvWindow = options.recvWindow;
    //     let query = Object.keys(data).reduce(function(a,k){a.push(k+'='+encodeURIComponent(data[k]));return a},[]).join('&');
    //     let signature = crypto.createHmac('sha256', options.APISECRET).update(query).digest('hex'); // set the HMAC hash header
    //
    //     let opt = reqObj(
    //       url+'?'+query+'&signature='+signature,
    //       data,
    //       method,
    //       options.APIKEY
    //     );
    //     proxyRequest(opt, callback);
    // };

     /**
     * No-operation function
     * @return {undefined}
     */
    const noop = function() {
      // do nothing
    };

    /**
     * Reworked Tuitio's heartbeat code into a shared single interval tick
     * @return {undefined}
     */
    const socketHeartbeat = function() {

        /* sockets removed from `subscriptions` during a manual terminate()
          will no longer be at risk of having functions called on them */
        for ( let endpointId in subscriptions ) {
            const ws = subscriptions[endpointId];
            if ( ws.isAlive ) {
                ws.isAlive = false;
                if ( ws.readyState === WebSocket.OPEN) ws.ping(noop);
            } else {
                if ( options.verbose ) options.log('Terminating inactive/broken WebSocket: '+ws.endpoint);
                if ( ws.readyState === WebSocket.OPEN) ws.terminate();
            }
        }
    };

    /**
     * Called when socket is opened, subscriptiosn are registered for later reference
     * @param {function} opened_callback - a callback function
     * @return {undefined}
     */
    const handleSocketOpen = function(opened_callback) {
        this.isAlive = true;
        if (Object.keys(subscriptions).length === 0) {
            socketHeartbeatInterval = setInterval(socketHeartbeat, 30000);
        }
        subscriptions[this.endpoint] = this;
        if ( typeof opened_callback === 'function' ) opened_callback(this);
    };

    /**
     * Called when socket is closed, subscriptiosn are deregistered for later reference
     * @param {boolean} reconnect - true or false to reconnect the socket
     * @param {string} code - code associated with the socket
     * @param {string} reason - string with the response
     * @return {undefined}
     */
    const handleSocketClose = function(reconnect, code, reason) {
        delete subscriptions[this.endpoint];
        if (Object.keys(subscriptions).length === 0) {
            clearInterval(socketHeartbeatInterval);
        }
        options.log('WebSocket closed: '+this.endpoint+
            (code ? ' ('+code+')' : '')+
            (reason ? ' '+reason : ''));
        if ( options.reconnect && this.reconnect && reconnect ) {
            if ( parseInt(this.endpoint.length, 10) === 60 ) options.log('Account data WebSocket reconnecting...');
            else options.log('WebSocket reconnecting: '+this.endpoint+'...');
            try {
                reconnect();
            } catch ( error ) {
                options.log('WebSocket reconnect error: '+error.message);
            }
        }
    };

    /**
     * Called when socket errors
     * @param {object} error - error object message
     * @return {undefined}
     */
    const handleSocketError = function(error) {

        /* Errors ultimately result in a `close` event.
          see: https://github.com/websockets/ws/blob/828194044bf247af852b31c49e2800d557fedeff/lib/websocket.js#L126 */
        options.log('WebSocket error: '+this.endpoint+
            (error.code ? ' ('+error.code+')' : '')+
            (error.message ? ' '+error.message : ''));
    };

    /**
     * Called each time the socket heartsbeats
     * @return {undefined}
     */
    const handleSocketHeartbeat = function() {
        this.isAlive = true;
    };


    /**
     * Used to subscribe to a single websocket endpoint
     * @param {string} endpoint - endpoint to connect to
     * @param {function} callback - the function to called when infomration is received
     * @param {boolean} reconnect - whether to reocnect on disconnect
     * @param {object} opened_callback - the function to called when opened
     * @return {WebSocket} - websocket reference
     */
    const subscribe = function(endpoint, callback, reconnect = false, opened_callback = false) {

        let httpsproxy = process.env.https_proxy || false;
        let socksproxy = process.env.socks_proxy || false;
        let ws = false;

        if ( socksproxy !== false ) {
            socksproxy = proxyReplacewithIp(socksproxy);
            if ( options.verbose ) options.log('using socks proxy server ' + socksproxy);
            let agent = new SocksProxyAgent({
                protocol: parseProxy(socksproxy)[0],
                host: parseProxy(socksproxy)[1],
                port: parseProxy(socksproxy)[2]
            });
            ws = new WebSocket(stream+endpoint, { agent: agent });
        } else if ( httpsproxy !== false ) {
            if ( options.verbose ) options.log('using proxy server ' + agent);
            let config = url.parse(httpsproxy);
            let agent = new HttpsProxyAgent(config);
            ws = new WebSocket(stream+endpoint, { agent: agent });
        } else {
            ws = new WebSocket(stream+endpoint);
        }

        if ( options.verbose ) options.log('Subscribed to '+endpoint);
        ws.reconnect = options.reconnect;
        ws.endpoint = endpoint;
        ws.isAlive = false;
        ws.on('open', handleSocketOpen.bind(ws, opened_callback));
        ws.on('pong', handleSocketHeartbeat);
        ws.on('error', handleSocketError);
        ws.on('close', handleSocketClose.bind(ws, reconnect));
        ws.on('message', function(data) {
            try {
                callback(JSON.parse(data));
            } catch (error) {
                options.log('Parse error: '+error.message);
            }
        });
        return ws;
    };


     /**
     * Used to subscribe to a combined websocket endpoint
     * @param {string} streams - streams to connect to
     * @param {function} callback - the function to called when infomration is received
     * @param {boolean} reconnect - whether to reocnect on disconnect
     * @param {object} opened_callback - the function to called when opened
     * @return {WebSocket} - websocket reference
     */
    const subscribeCombined = function(streams, callback, reconnect = false, opened_callback = false) {

      let httpsproxy = process.env.https_proxy || false;
      let socksproxy = process.env.socks_proxy || false;
      const queryParams = streams.join('/');
      let ws = false;

      if ( socksproxy !== false ) {
          socksproxy = proxyReplacewithIp(socksproxy);
          if ( options.verbose ) options.log('using socks proxy server ' + socksproxy);
          let agent = new SocksProxyAgent({
              protocol: parseProxy(socksproxy)[0],
              host: parseProxy(socksproxy)[1],
              port: parseProxy(socksproxy)[2]
          });

          ws = new WebSocket(combineStream, { agent: agent });
      } else if ( httpsproxy !== false ) {
          if ( options.verbose ) options.log('using proxy server ' + httpsproxy);
          let config = url.parse(httpsproxy);
          let agent = new HttpsProxyAgent(config);
          ws = new WebSocket(combineStream, { agent: agent });
      } else {
          ws = new WebSocket(combineStream);
      }

      ws.reconnect = options.reconnect;
      ws.endpoint = stringHash(queryParams);
      //ws.isAlive = false;
     // if ( options.verbose ) {
      //   options.log('CombinedStream: Subscribed to ['+ws.endpoint+'] '+queryParams);
     // }
      ws.on('open', handleSocketOpen.bind(ws, opened_callback));
      ws.on('pong', handleSocketHeartbeat);
      ws.on('error', handleSocketError);
      ws.on('close', handleSocketClose.bind(ws, reconnect));
      ws.on('message', function(data) {
          data = pako.inflate(data,{ to: 'string' });
          try {
            let msg = JSON.parse(data);
            if (msg.ping) {
              ws.send(JSON.stringify({ pong: msg.ping }));
            } else if (msg.subbed) {
              //options.log('subbed: '+msg.id +" status: "+msg.status );
            } else {
              callback( JSON.parse(data) );
            }
          } catch (error) {
              options.log('CombinedStream: Parse error: '+error.message +'-> '+ JSON.stringify(data) );
          }
      });
      return ws;
    };


    /**
     * Used to terminate a web socket
     * @param {string} endpoint - endpoint identifier associated with the web socket
     * @param {boolean} reconnect - auto reconnect after termination
     * @return {undefined}
     */
    const terminate = function(endpoint, reconnect = false) {
      let ws = subscriptions[endpoint];
      if ( !ws ) return;
      ws.removeAllListeners('message');
      ws.reconnect = reconnect;
      ws.terminate();
    }

    /**
     * Gets depth cache for given symbol
     * @param {string} symbol - the symbol to fetch
     * @return {object} - the depth cache object
     */
    const getDepthCache = function(symbol) {
        if ( typeof depthCache[symbol] === 'undefined' ) return {bids: {}, asks: {}};
        return depthCache[symbol];
    };

     /**
     * Checks whether or not an array contains any duplicate elements
     *  Note(keith1024): at the moment this only works for primitive types,
     *  will require modification to work with objects
     * @param {array} array - the array to check
     * @return {boolean} - true or false
     */
    const isArrayUnique = function(array) {
      let s = new Set(array);
      return s.size === array.length;
    };

    /**
     * Used for /depth endpoint
     * @param {object} data - containing the bids and asks
     * @return {undefined}
     */
    const depthData = function(data) {
      if ( !data ) return {bids:[], asks:[]};
      let bids = {}, asks = {}, obj;
      if ( typeof data.tick.bids !== 'undefined' ) {
          for ( obj of data.tick.bids ) {
              bids[obj[0]] = parseFloat(obj[1]);
          }
      }
      if ( typeof data.tick.asks !== 'undefined' ) {
          for ( obj of data.tick.asks ) {
              asks[obj[0]] = parseFloat(obj[1]);
          }
      }
      return {lastUpdateId: data.ts, bids:bids, asks:asks};
    }
    /**
     * Used for /depth endpoint
     * @param {object} depth - information
     * @return {undefined}
     */
    const depthHandler = function(depth) {
        let symbol = depth.ch.split('.')[1], obj;
        let context = depthCacheContext[symbol];

        let updateDepthCache = function() {
            //options.log('updateDepthCache---->');
            for ( obj of depth.tick.bids) { //bids
                depthCache[symbol].bids[obj[0]] = parseFloat(obj[1]);
                if ( obj[1] === '0.00000000' ) {
                    delete depthCache[symbol].bids[obj[0]];
                }
            }
            for ( obj of depth.tick.asks ) { //asks
                depthCache[symbol].asks[obj[0]] = parseFloat(obj[1]);
                if ( obj[1] === '0.00000000' ) {
                    delete depthCache[symbol].asks[obj[0]];
                }
            }
            context.skipCount = 0;
            context.lastEventUpdateId = depth.ts;
        }

        // This now conforms 100% to the Binance docs constraints on managing a local order book
        if ( context.lastEventUpdateId ) {
            const expectedUpdateId = context.lastEventUpdateId + 1;
            if ( depth.ts <= expectedUpdateId ) {
                updateDepthCache();
            } else {
                let msg = 'depthHandler: ['+symbol+'] The depth cache is out of sync.';
                msg += ' Symptom: Unexpected Update ID. Expected "'+expectedUpdateId+'", got "'+depth.U+'"';
                if ( options.verbose ) options.log(msg);
                throw new Error(msg);
            }
        } else if ( depth.ts < context.snapshotUpdateId + 1 ) {
            /* In this case we have a gap between the data of the stream and the snapshot.
               This is an out of sync error, and the connection must be torn down and reconnected. */
            let msg = 'depthHandler: ['+symbol+'] The depth cache is out of sync.';
            msg += ' Symptom: Gap between snapshot and first stream data.';
            if ( options.verbose ) options.log(msg);
            throw new Error(msg);
        } else {
            // This is our first legal update from the stream data
            updateDepthCache();
        }
    };


    return {
      /**
        * Gets an option fiven a key
        * @param {object} opt - the object with the class configuration
        * @param {function} callback - the callback function
        * @return {undefined}
        */
        options: function(opt, callback = false) {
        if ( typeof opt === 'string' ) { // Pass json config filename
            options = JSON.parse(file.readFileSync(opt));
        } else options = opt;
        if ( typeof options.recvWindow === 'undefined' ) options.recvWindow = default_options.recvWindow;
        if ( typeof options.useServerTime === 'undefined' ) options.useServerTime = default_options.useServerTime;
        if ( typeof options.reconnect === 'undefined' ) options.reconnect = default_options.reconnect;
        if ( typeof options.test === 'undefined' ) options.test = default_options.test;
        if ( typeof options.log === 'undefined' ) options.log = default_options.log;
        if ( typeof options.verbose === 'undefined' ) options.verbose = default_options.verbose;
        if ( options.useServerTime ) {
            apiRequest(base+'v1/time', {}, function(error, response) {
                info.timeOffset = response.serverTime - new Date().getTime();
                //options.log("server time set: ", response.serverTime, info.timeOffset);
                if ( callback ) callback();
            });
        } else if ( callback ) callback();
        },

        /**
         * Gets depth cache for given symbol
         * @param {symbol} symbol - get depch cache for this symbol
         * @return {object} - object
         */
        depthCache: function(symbol) {
            return getDepthCache(symbol);
        },

        /**
        * Gets the the exchange info
        * @param {function} callback - the callback function
        * @return {undefined}
        */
       exchangeInfo: function(callback) {
        publicRequest(base+'v1/common/symbols', {}, callback);
       },


        /**
         * Sorts bids
         * @param {string} symbol - the object
         * @param {int} max - the max number of bids
         * @param {string} baseValue - the object
         * @return {object} - the object
         */
        sortBids: function(symbol, max = Infinity, baseValue = false) {
            let object = {}, count = 0, cache;
            if ( typeof symbol === 'object' ) cache = symbol;
            else cache = getDepthCache(symbol).bids;
            let sorted = Object.keys(cache).sort(function(a, b){return parseFloat(b)-parseFloat(a)});
            let cumulative = 0;
            for ( let price of sorted ) {
                if ( baseValue === 'cumulative' ) {
                    cumulative+= parseFloat(cache[price]);
                    object[price] = cumulative;
                } else if ( !baseValue ) object[price] = parseFloat(cache[price]);
                else object[price] = parseFloat((cache[price] * parseFloat(price)).toFixed(8));
                if ( ++count >= max ) break;
            }
            return object;
        },

        /**
         * Sorts asks
         * @param {string} symbol - the object
         * @param {int} max - the max number of bids
         * @param {string} baseValue - the object
         * @return {object} - the object
         */
        sortAsks: function(symbol, max = Infinity, baseValue = false) {
            let object = {}, count = 0, cache;
            if ( typeof symbol === 'object' ) cache = symbol;
            else cache = getDepthCache(symbol).asks;
            let sorted = Object.keys(cache).sort(function(a, b){return parseFloat(a)-parseFloat(b)});
            let cumulative = 0;
            for ( let price of sorted ) {
                if ( baseValue === 'cumulative' ) {
                    cumulative+= parseFloat(cache[price]);
                    object[price] = cumulative;
                } else if ( !baseValue ) object[price] = parseFloat(cache[price]);
                else object[price] = parseFloat((cache[price] * parseFloat(price)).toFixed(8));
                if ( ++count >= max ) break;
            }
            return object;
        },
    websockets: {
              /**
              * Websocket depth cache
              * @param {array/string} symbols - an array or string of symbols to query
              * @param {function} callback - callback function
              * @param {int} limit - the number of entires
              * @return {string} the websocket endpoint
              */
              depthCache: function depthCacheFunction(symbols, callback, limit = 500) {
                let reconnect = function() {
                    if ( options.reconnect ) depthCacheFunction(symbols, callback, limit);
                };

                let symbolDepthInit = function(symbol) {
                    if ( typeof depthCacheContext[symbol] === 'undefined' ) depthCacheContext[symbol] = {};

                    let context = depthCacheContext[symbol];
                    context.snapshotUpdateId = null;
                    context.lastEventUpdateId = null;
                    context.messageQueue = [];
                    //options.log('symbol: ' + symbol+" create queue");
                    depthCache[symbol] = { bids: {}, asks: {} };
                };

                let assignEndpointIdToContext = function(symbol, endpointId) {
                    if ( depthCacheContext[symbol] ) {
                        let context = depthCacheContext[symbol];
                        context.endpointId = endpointId;
                    }
                };

                let handleDepthStreamData = function(depth) {
                    //options.log("---->"+Object.keys(depth ))
                    let symbol = depth.ch.split('.')[1];
                    let context = depthCacheContext[symbol];
                    if (context.messageQueue && !context.snapshotUpdateId ) {
                        context.messageQueue.push(depth);
                    }
                    try {
                        depthCache[symbol] = depthData(depth)
                        depthHandler(depth);
                    } catch (err) {
                        return terminate(context.endpointId, true);
                    }
                    if ( callback ) callback(symbol, depthCache[symbol]);
                };

                // let getSymbolDepthSnapshot = function(symbol){
                //       return new Promise((resolve, reject) => {
                //           publicRequest(base+'market/depth', { symbol:symbol, type:'step0' }, function(error, json) {
                //               if (error) {
                //                   return reject(error)
                //               }
                //               json.symb = symbol;
                //               resolve(json)
                //           });
                //       })
                // };
                // let updateSymbolDepthCache = function (json) {
                //     let symbol = json.symb;
                //     depthCache[symbol] = depthData(json);
                //     // Prepare depth cache context
                //     let context = depthCacheContext[symbol];
                //     context.snapshotUpdateId = json.ts;
                //     //options.log('symbol: ' + symbol+" delete queue");
                //     context.messageQueue = context.messageQueue.filter(depth => depth.ts > context.snapshotUpdateId);
                //     // Process any pending depth messages
                //     for ( let depth of context.messageQueue ) {
                //
                //         /* Although sync errors shouldn't ever happen here, we catch and swallow them anyway
                //           just in case. The stream handler function above will deal with broken caches. */
                //         try {depthHandler(depth);} catch (err) {
                //             // do nothing
                //         }
                //     }
                //     delete context.messageQueue;
                //     if ( callback ) callback(symbol, depthCache[symbol]);
                // };

                /* If an array of symbols are sent we use a combined stream connection rather.
                  This is transparent to the developer, and results in a single socket connection.
                  This essentially eliminates "unexpected response" errors when subscribing to a lot of data. */
                let subscription;
                if ( Array.isArray(symbols) ) {
                    if ( !isArrayUnique(symbols) ) throw Error('depthCache: "symbols" cannot contain duplicate elements.');

                    symbols.forEach(symbolDepthInit);
                    let streams = symbols.map(function (symbol) {
                      return 'market.'+symbol.toLowerCase()+'.depth.step0';
                       //return symbol.toLowerCase()+'@depth';
                    });
                    //options.log('streams: ' + streams);
                    subscription = subscribeCombined(streams, handleDepthStreamData, reconnect, function(ws) {


                        for (let symbol of symbols) {
                          ws.send(JSON.stringify({
                              'sub': `market.${symbol.toLowerCase()}.depth.step0`,
                              'id': `${symbol.toLowerCase()}`
                          }));
                         }
                    });
                    symbols.forEach(s => assignEndpointIdToContext(s, subscription.endpoint));
                } else {
                    let symbol = symbols;
                    symbolDepthInit(symbol);
                    subscription = subscribe(symbol.toLowerCase()+'@depth', handleDepthStreamData, reconnect, function() {
                       // getSymbolDepthSnapshot(symbol);
                    });
                    assignEndpointIdToContext(symbol, subscription.endpoint);
                }
                return subscription.endpoint;
              },

              /**
              * Subscribe to a generic websocket
              * @param {string} url - the websocket endpoint
              * @param {function} callback - optional execution callback
              * @param {boolean} reconnect - subscription callback
              * @return {WebSocket} the websocket reference
              */
              subscribe: function(url, callback, reconnect = false) {
                  return subscribe(url, callback, reconnect);
              }
          }
    }
 }();

