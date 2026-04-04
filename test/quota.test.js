import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ===== Mock D1 Database =====
class MockD1 {
  constructor() { this.tables = {}; this.lastRowId = 0; }

  prepare(sql) {
    const self = this;
    let bindings = [];
    return {
      bind(...args) { bindings = args; return this; },
      async run() {
        self.lastRowId += 1;
        return { meta: { last_row_id: self.lastRowId } };
      },
      async first() { return self._query(sql, bindings); },
      async all() { return { results: self._queryAll(sql, bindings) }; },
    };
  }

  batch(stmts) { return Promise.all(stmts.map((s) => s.run())); }

  _store(table, row) {
    if (!this.tables[table]) this.tables[table] = [];
    this.tables[table].push(row);
  }

  _query(sql, bindings) { return null; }
  _queryAll(sql, bindings) { return []; }
}

// ===== Import DB module =====
const dbPath = '../functions/_lib/db.js';
const {
  initTables, upsertUser, recordVisit, getUserRole, getUserBySub,
  getEffectivePlan, PLAN_LIMITS, getDailyUsage, incrementDailyUsage,
  addCompressLog, listCompressLogs, clearCompressLogs, getUserStats,
  updatePreferences, updateUserName, deleteUserAccount, listUsers, listVisits,
} = await import(dbPath);

// ===== Tests =====

describe('PLAN_LIMITS', () => {
  it('should define guest/free/pro plans', () => {
    assert.ok(PLAN_LIMITS.guest);
    assert.ok(PLAN_LIMITS.free);
    assert.ok(PLAN_LIMITS.pro);
  });

  it('guest should have 3 daily limit', () => {
    assert.equal(PLAN_LIMITS.guest.daily, 3);
    assert.equal(PLAN_LIMITS.guest.maxFiles, 1);
    assert.equal(PLAN_LIMITS.guest.maxSizeMB, 5);
  });

  it('free should have 20 daily limit', () => {
    assert.equal(PLAN_LIMITS.free.daily, 20);
    assert.equal(PLAN_LIMITS.free.maxFiles, 5);
    assert.equal(PLAN_LIMITS.free.maxSizeMB, 10);
  });

  it('pro should have unlimited daily', () => {
    assert.equal(PLAN_LIMITS.pro.daily, -1);
    assert.equal(PLAN_LIMITS.pro.maxFiles, 20);
    assert.equal(PLAN_LIMITS.pro.maxSizeMB, 20);
    assert.equal(PLAN_LIMITS.pro.batchZip, true);
  });

  it('guest quality should be locked', () => {
    assert.equal(PLAN_LIMITS.guest.qualityLocked, true);
    assert.equal(PLAN_LIMITS.free.qualityLocked, false);
    assert.equal(PLAN_LIMITS.pro.qualityLocked, false);
  });

  it('guest should only support jpeg', () => {
    assert.deepEqual(PLAN_LIMITS.guest.formats, ['image/jpeg']);
  });

  it('pro should support avif', () => {
    assert.ok(PLAN_LIMITS.pro.formats.includes('image/avif'));
  });
});

describe('getEffectivePlan', () => {
  it('should return free for null user', () => {
    assert.equal(getEffectivePlan(null), 'free');
  });

  it('should return free for user with free plan', () => {
    assert.equal(getEffectivePlan({ plan: 'free', role: 'user' }), 'free');
  });

  it('should return pro for user with pro plan', () => {
    assert.equal(getEffectivePlan({ plan: 'pro', role: 'user' }), 'pro');
  });

  it('should return free for expired pro plan', () => {
    assert.equal(getEffectivePlan({
      plan: 'pro', role: 'user',
      plan_expires_at: '2020-01-01T00:00:00Z'
    }), 'free');
  });

  it('should return pro for admin regardless of plan', () => {
    assert.equal(getEffectivePlan({ plan: 'free', role: 'admin' }), 'pro');
  });
});

describe('initTables', () => {
  it('should not throw', async () => {
    const db = new MockD1();
    await assert.doesNotReject(() => initTables(db));
  });
});

describe('upsertUser', () => {
  it('should return correct structure for new user', async () => {
    const db = new MockD1();
    db._query = () => null; // no existing user
    const result = await upsertUser(db, {
      sub: 'google-123', email: 'test@example.com', name: 'Test', picture: 'https://pic.jpg',
    });
    assert.ok(result.userId);
    assert.equal(result.role, 'user');
    assert.equal(result.plan, 'free');
    assert.equal(result.isNew, true);
  });

  it('should return existing user info', async () => {
    const db = new MockD1();
    db._query = () => ({ id: 42, role: 'user', plan: 'pro', plan_expires_at: null });
    const result = await upsertUser(db, {
      sub: 'google-123', email: 'test@example.com', name: 'Test', picture: '',
    });
    assert.equal(result.userId, 42);
    assert.equal(result.plan, 'pro');
    assert.equal(result.isNew, false);
  });

  it('should set admin role for admin email', async () => {
    const db = new MockD1();
    db._query = () => null;
    const result = await upsertUser(db, {
      sub: 'google-admin', email: 'liqibo1994@gmail.com', name: 'Admin', picture: '',
    });
    assert.equal(result.role, 'admin');
  });
});

describe('getUserBySub', () => {
  it('should return null for non-existing user', async () => {
    const db = new MockD1();
    db._query = () => null;
    const user = await getUserBySub(db, 'non-existing');
    assert.equal(user, null);
  });
});

describe('recordVisit', () => {
  it('should not throw', async () => {
    const db = new MockD1();
    const mockRequest = {
      headers: new Map([['cf-connecting-ip', '1.2.3.4'], ['user-agent', 'test']]),
    };
    mockRequest.headers.get = (k) => mockRequest.headers.has(k) ? mockRequest.headers.get(k) : '';
    // fix get method
    const h = new Map([['cf-connecting-ip', '1.2.3.4'], ['user-agent', 'test']]);
    const req = { headers: { get: (k) => h.get(k) || '' } };
    await assert.doesNotReject(() => recordVisit(db, 1, 'test@test.com', 'Test', req));
  });
});

describe('getDailyUsage', () => {
  it('should return zero for no usage', async () => {
    const db = new MockD1();
    db._query = () => null;
    const usage = await getDailyUsage(db, { userId: 1 });
    assert.equal(usage.compress_count, 0);
  });

  it('should return existing usage', async () => {
    const db = new MockD1();
    db._query = () => ({ compress_count: 5, total_original_bytes: 1000, total_compressed_bytes: 500 });
    const usage = await getDailyUsage(db, { userId: 1 });
    assert.equal(usage.compress_count, 5);
  });

  it('should query by guest IP', async () => {
    const db = new MockD1();
    db._query = () => ({ compress_count: 2, total_original_bytes: 100, total_compressed_bytes: 50 });
    const usage = await getDailyUsage(db, { guestIp: '1.2.3.4' });
    assert.equal(usage.compress_count, 2);
  });
});

describe('incrementDailyUsage', () => {
  it('should not throw for user', async () => {
    const db = new MockD1();
    db._query = () => null;
    await assert.doesNotReject(() => incrementDailyUsage(db, {
      userId: 1, originalBytes: 1000, compressedBytes: 500, count: 1,
    }));
  });

  it('should not throw for guest', async () => {
    const db = new MockD1();
    db._query = () => null;
    await assert.doesNotReject(() => incrementDailyUsage(db, {
      guestIp: '1.2.3.4', originalBytes: 1000, compressedBytes: 500, count: 1,
    }));
  });

  it('should update existing row for user', async () => {
    const db = new MockD1();
    db._query = () => ({ id: 1 }); // existing row
    await assert.doesNotReject(() => incrementDailyUsage(db, {
      userId: 1, originalBytes: 500, compressedBytes: 200, count: 1,
    }));
  });
});

describe('addCompressLog', () => {
  it('should not throw', async () => {
    const db = new MockD1();
    await assert.doesNotReject(() => addCompressLog(db, 1, {
      fileName: 'test.jpg', originalSize: 1000, compressedSize: 500,
      format: 'image/jpeg', quality: 0.8,
    }));
  });
});

describe('listCompressLogs', () => {
  it('should return empty list', async () => {
    const db = new MockD1();
    db._query = () => ({ total: 0 });
    db._queryAll = () => [];
    const result = await listCompressLogs(db, 1, 1, 20);
    assert.equal(result.total, 0);
    assert.deepEqual(result.logs, []);
  });
});

describe('getUserStats', () => {
  it('should return zero stats', async () => {
    const db = new MockD1();
    db._query = (sql) => {
      if (sql.includes('COUNT')) return { cnt: 0 };
      if (sql.includes('SUM')) return { total_original: 0, total_compressed: 0 };
      return null;
    };
    const stats = await getUserStats(db, 1);
    assert.equal(stats.totalCompressions, 0);
    assert.equal(stats.totalSavedBytes, 0);
  });
});

describe('updatePreferences', () => {
  it('should not throw', async () => {
    const db = new MockD1();
    await assert.doesNotReject(() => updatePreferences(db, 'sub-123', { quality: 0.7 }));
  });
});

describe('updateUserName', () => {
  it('should not throw', async () => {
    const db = new MockD1();
    await assert.doesNotReject(() => updateUserName(db, 'sub-123', 'New Name'));
  });
});

describe('deleteUserAccount', () => {
  it('should not throw', async () => {
    const db = new MockD1();
    await assert.doesNotReject(() => deleteUserAccount(db, 1));
  });
});
