/**
 * Shared PubSub instance for GraphQL Subscriptions.
 *
 * PubSub is an in-memory event bus — publish an event and all active
 * subscription listeners receive it immediately.
 *
 * For production with multiple server instances, replace PubSub with
 * RedisPubSub from the `graphql-redis-subscriptions` package so events
 * are shared across all nodes.
 */
const { PubSub } = require('graphql-subscriptions');

const pubsub = new PubSub();

const EVENTS = {
  PRODUCT_CREATED: 'PRODUCT_CREATED',
  PRODUCT_UPDATED: 'PRODUCT_UPDATED',
  PRODUCT_DELETED: 'PRODUCT_DELETED',
};

module.exports = { pubsub, EVENTS };
