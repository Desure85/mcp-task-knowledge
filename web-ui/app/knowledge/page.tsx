/**
 * web-ui/app/knowledge/page.tsx — Knowledge list (UI-001/UI-003)
 */

'use client';

import { useState, useEffect } from 'react';
import { api, type KnowledgeDoc } from '@/lib/api-client';

export default function KnowledgePage() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDocs();
  }, []);

  async function loadDocs() {
    try {
      setLoading(true);
      const data = await api.knowledge.list();
      setDocs(Array.isArray(data) ? data : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Knowledge Base</h1>
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded">{error}</div>}
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : docs.length === 0 ? (
        <p className="text-gray-500">No documents yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {docs.map((doc) => (
            <div key={doc.id} className="bg-white p-4 rounded-lg border">
              <h2 className="font-semibold text-lg mb-1">{doc.title}</h2>
              {doc.tags && doc.tags.length > 0 && (
                <div className="flex gap-1 mb-2">
                  {doc.tags.map((tag) => (
                    <span key={tag} className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded">{tag}</span>
                  ))}
                </div>
              )}
              <p className="text-sm text-gray-600 line-clamp-3">{doc.content?.slice(0, 200)}...</p>
              <p className="text-xs text-gray-400 mt-2">Updated: {new Date(doc.updatedAt).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
