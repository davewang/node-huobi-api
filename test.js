const TIMEOUT = 10000;

let chai = require( 'chai' );
let assert = chai.assert;
let path = require( 'path' );
let huobi = require( path.resolve( __dirname, 'node-huobi-api.js' ) )();
let util = require( 'util' );


let logger = {
  log: function (msg){
    let logLineDetails = ((new Error().stack).split('at ')[3]).trim();
    let logLineNum = logLineDetails.split(':');
    console.log('DEBUG', logLineNum[1] + ':' + logLineNum[2], msg);
  }
}

let debug = function( x ) {
    // if ( typeof ( process.env.node_huobi_api ) === 'undefined' ) {
    //   return;
    // }
    logger.log( typeof ( x ) );
    logger.log( util.inspect( x ) );
}

debug('Begin');

/*global describe*/
/*eslint no-undef: "error"*/
describe( 'Construct', function() {
    /*global it*/
    /*eslint no-undef: "error"*/
    it( 'Construct the huobi object', function( done ) {
        huobi.options( {
        APIKEY: process.env.APIKEY,
        APISECRET:process.env.APISECRET,
        useServerTime: true,
        reconnect: true,
        verbose: true,
        log: debug
      } );
      assert( typeof ( huobi ) === 'object', 'Huobi is not an object' );
      done();
    } ).timeout( TIMEOUT );
  } );

describe( 'exchangeInfo', function() {
it( 'Call exchangeInfo', function( done ) {
    huobi.exchangeInfo((error, data) => {
        assert(error === null);
        debug( error );
        debug( data );
        done();
    });
}).timeout( TIMEOUT );
});

describe( 'account', function() {
    it( 'Call account', function( done ) {
        huobi.account((error, data) => {
            assert(error === null);
            debug( error );
            debug( data );
            done();
        });
    }).timeout( TIMEOUT );
});

describe( 'balance', function() {
    it( 'Call balance', function( done ) {
        huobi.account((error, data) => {
            assert(error === null);
            debug( error );
            debug( data );
            if (error == null){
                huobi.balance(data.data[0].id,(error1,data1)=>{
                    debug( error );
                    debug( data );
                    done();
                });
            }
        });
    }).timeout( TIMEOUT );
});


describe( 'time', function() {
    it( 'Call time', function( done ) {
        huobi.time((error, data) => {
            assert(error === null);
            debug( error );
            debug( data );
            done();
        });
    }).timeout( TIMEOUT );
});


describe( 'depthCache', function() {
    it( 'Call depthCache', function( done ) {
        const tickers=['xrpbtc', 'bchusdt'];
        huobi.websockets.depthCache( tickers,(symbol, depth) => {
            debug(symbol+'=='+ JSON.stringify( depth) );

        },10);
        //done();
    }).timeout( TIMEOUT );
});

describe( 'depthCacheStaggered', function() {
    it( 'Call depthCacheStaggered', function( done ) {
        const tickers=['xrpbtc', 'bchusdt'];
        huobi.websockets.depthCacheStaggered( tickers,(symbol, depth) => {
            debug(symbol+'=='+ JSON.stringify( depth) );
            done();
        },10);
        //done();
    }).timeout( TIMEOUT );
});
