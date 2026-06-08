/**
 * GraphQL server setup.
 *
 * Uses Apollo Server v4 mounted on the existing Express app:
 *   - HTTP queries/mutations → POST /graphql
 *   - WebSocket subscriptions → ws://localhost:PORT/graphql
 *
 * Call applyGraphQL(app, httpServer) once before httpServer.listen().
 */

const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const { ApolloServerPluginDrainHttpServer } = require('@apollo/server/plugin/drainHttpServer');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const { WebSocketServer } = require('ws');
const { useServer } = require('graphql-ws/lib/use/ws');

const { typeDefs } = require('./typeDefs');
const { resolvers } = require('./resolvers');
const authService = require('../services/authService');
const userRepository = require('../repositories/userRepository');

/**
 * Extract and verify a JWT, returning the user object or null.
 * Used for both HTTP context and WebSocket connection context.
 */
async function getUserFromToken(token) {
  if (!token) return null;
  try {
    const payload = authService.verifyAccessToken(token);
    return await userRepository.findById(payload.sub);
  } catch {
    return null;
  }
}

/**
 * Mount Apollo Server (HTTP) and a WebSocket subscription server on the
 * provided Express app and Node http.Server.
 *
 * @param {import('express').Application} app
 * @param {import('http').Server} httpServer
 */
async function applyGraphQL(app, httpServer) {
  // Build an executable schema from type definitions and resolvers
  const schema = makeExecutableSchema({ typeDefs, resolvers });

  // ── WebSocket server for subscriptions ────────────────────────────────────
  const wsServer = new WebSocketServer({ server: httpServer, path: '/graphql' });

  const wsServerCleanup = useServer(
    {
      schema,

      // How long (ms) the server waits for the client to send connection_init
      // after the WebSocket is opened. Default is 3000ms — too short for manual
      // testing in Postman. Set to 0 to disable the timeout entirely in dev.
      connectionInitWaitTimeout: process.env.NODE_ENV === 'production' ? 3000 : 0,

      /**
       * WebSocket context — called when a subscription connection is opened.
       * Clients pass their JWT in connectionParams.authorization.
       */
      context: async (ctx) => {
        const token = ctx.connectionParams?.authorization?.replace('Bearer ', '');
        const user = await getUserFromToken(token);
        return { user };
      },
      onConnect: () => {
        console.log('[GraphQL WS] Client connected');
      },
      onDisconnect: () => {
        console.log('[GraphQL WS] Client disconnected');
      },
    },
    wsServer
  );

  // ── Apollo Server (HTTP) ───────────────────────────────────────────────────
  const apolloServer = new ApolloServer({
    schema,
    plugins: [
      // Gracefully drain HTTP connections on shutdown
      ApolloServerPluginDrainHttpServer({ httpServer }),
      // Gracefully close WebSocket connections on shutdown
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await wsServerCleanup.dispose();
            },
          };
        },
      },
    ],
  });

  await apolloServer.start();

  /**
   * Mount at /graphql.
   * Context function runs on every HTTP request — extracts the user from
   * the Authorization header and attaches it so resolvers can do auth checks.
   */
  app.use(
    '/graphql',
    expressMiddleware(apolloServer, {
      context: async ({ req }) => {
        const authHeader = req.headers.authorization;
        const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
        const user = await getUserFromToken(token);
        return { user };
      },
    })
  );

  return wsServerCleanup;
}

module.exports = { applyGraphQL };
