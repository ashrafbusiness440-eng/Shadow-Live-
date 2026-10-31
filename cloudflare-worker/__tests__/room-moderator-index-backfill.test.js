import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {backfillRoomModeratorIndexPage} from '../src/room-moderator-index-backfill.js';

const legacy = readFileSync(new URL('../src/voice-session-legacy.js', import.meta.url), 'utf8');
const migrationRoute = legacy.slice(
  legacy.indexOf('async function roomModeratorIndexBackfill('),
  legacy.indexOf('// Authorized shortcuts for the current user'),
);

function fakeDb(initialRooms) {
  const rooms = new Map(Object.entries(initialRooms).map(([id, data]) => [
    id, structuredClone(data),
  ]));
  const memberships = new Map();
  const audits = new Map();
  let transactionHook;
  const calls = {queried:0, transactions:0, writes:0, indexed:0};
  function ref(collection, id) {
    return {
      id,
      async get() {
        if (collection === 'rooms') {
          return {id, ref: this, exists: rooms.has(id),
            data: () => structuredClone(rooms.get(id) || {})};
        }
        throw new Error('unexpected_collection_get');
      },
      collection(child) {
        return {
          doc: (childId) => ref(collection + '/' + id + '/' + child, childId),
        };
      },
      collectionName: collection,
    };
  }
  const db = {
    collection(name) {
      const root = {
        doc: (id) => ref(name,id),
        orderBy(field) {
          assert.equal(field,'__name__');
          let limitValue = 10;
          let after = '';
          const query = {
            limit(n) { limitValue = n; return query; },
            startAfter(snapshot) {
              assert.equal(snapshot.exists,true);
              after = snapshot.id;
              return query;
            },
            async get() {
              calls.queried++;
              const ids = [...rooms.keys()].sort().filter(id => id > after)
                .slice(0,limitValue);
              return {docs:ids.map(id => ({
                id,ref:ref('rooms',id),data:()=>structuredClone(rooms.get(id) || {}),
              }))};
            },
          };
          return query;
        },
      };
      return root;
    },
    async runTransaction(callback) {
      calls.transactions++;
      transactionHook?.(rooms);
      transactionHook = null;
      const writes=[];
      const tx = {
        get: async (reference)=>reference.get(),
        set(reference,data,options) {
          assert.equal(options?.merge,true);
          writes.push({reference,data});
        },
      };
      const result=await callback(tx);
      for(const {reference,data} of writes) {
        if (reference.collectionName.startsWith('room_moderator_memberships')) {
          memberships.set(reference.collectionName+'/'+reference.id,structuredClone(data));
          calls.indexed++;
        } else if (reference.collectionName.startsWith('room_audit_logs')) {
          audits.set(reference.collectionName+'/'+reference.id,structuredClone(data));
        } else {
          throw new Error('unexpected_mutation');
        }
        calls.writes++;
      }
      return result;
    },
  };
  return {db,rooms,memberships,audits,calls,
    onNextTransaction:hook=>{transactionHook=hook;}};
}
function normalize(room) {
  return Array.isArray(room.moderators) ? room.moderators : [];
}
const base = (db, extra={})=>backfillRoomModeratorIndexPage({
  db,actorUid:'owner_123',normalizeModerators:normalize,
  serverTimestamp:()=>({kind:'serverTimestamp'}),...extra,
});

test('historical moderation migration is OWNER-only and never triggered by browsing',()=>{
  assert.match(migrationRoute,/roomPermissions\(actor\)/);
  assert.match(migrationRoute,/!permissions\.appOwner\|\|!permissions\.ownerAbsoluteRoomAccess/);
  assert.match(migrationRoute,/mysteriousRoomAuthoritySuppressed\(actor\)/);
  assert.match(migrationRoute,/confirm:body\.confirm===true/);
  assert.match(migrationRoute,/limit>10/);
  assert.match(legacy,/if\(action==="roomModeratorIndexBackfillPage"\)/);
  const read = legacy.slice(legacy.indexOf('async function roomManagedList('),
    legacy.indexOf('function normalizeRoomMusicPolicy('));
  assert.doesNotMatch(read,/roomModeratorIndexBackfill|\.collection\("rooms"\)\s*\.orderBy\("__name__"/);
});

test('preview shows bounded candidates but does not write memberships or audits',async()=>{
  const f=fakeDb({
    room_a:{moderators:[{uid:'older_1'}]},
    room_b:{moderators:[{uid:'older_2'},{uid:'older_3'}]},
    room_c:{moderators:[]},
  });
  const one=await base(f.db,{limit:2});
  assert.deepEqual({scanned:one.scannedRooms,candidate:one.candidateMemberships,
    upserted:one.upsertedMemberships,cursor:one.nextCursor,dryRun:one.dryRun},
    {scanned:2,candidate:3,upserted:0,cursor:'room_b',dryRun:true});
  assert.equal(f.calls.writes,0);
  const next=await base(f.db,{limit:2,cursor:one.nextCursor});
  assert.equal(next.scannedRooms,1);
  assert.equal(next.complete,true);
  assert.equal(next.nextCursor,null);
  assert.equal(f.calls.queried,2);
});

test('confirmed migration writes only members still active in a re-read transaction',async()=>{
  const f=fakeDb({
    room_a:{moderators:[{uid:'older_1'},{uid:'removed_2'}]},
  });
  f.onNextTransaction(rooms=>{
    rooms.set('room_a',{moderators:[{uid:'older_1'}]});
  });
  const result=await base(f.db,{confirm:true});
  assert.equal(result.candidateMemberships,2);
  assert.equal(result.upsertedMemberships,1);
  assert.equal(f.calls.indexed,1);
  assert.equal(f.calls.writes,2); // membership + deterministic audit
  const ids=[...f.memberships.keys()].join(' ');
  assert.match(ids,/older_1/);
  assert.doesNotMatch(ids,/removed_2/);
  assert.equal(f.audits.size,1);
  assert.equal([...f.audits.values()][0].actorUid,'owner_123');
});

test('malformed legacy UID is ignored without throwing or writing to other collections',async()=>{
  const f=fakeDb({
    room_a:{moderators:[{uid:'valid_1'},{uid:'unsafe/uid'},{uid:'valid_1'}]},
  });
  const result=await base(f.db,{confirm:true,limit:1});
  assert.equal(result.malformedUidsSkipped,1);
  assert.equal(result.upsertedMemberships,1);
  assert.equal(f.calls.indexed,1);
  assert.equal(result.nextCursor,'room_a');
});

test('out-of-range pages, forged cursors and missing cursor docs fail closed',async()=>{
  const f=fakeDb({room_a:{moderators:[]}});
  await assert.rejects(base(f.db,{limit:11}),/invalid_room_moderator_backfill_arguments/);
  await assert.rejects(base(f.db,{cursor:'../evil'}),/invalid_room_moderator_backfill_arguments/);
  await assert.rejects(base(f.db,{cursor:'missing'}),/room_backfill_cursor_not_found/);
  assert.equal(f.calls.writes,0);
});
