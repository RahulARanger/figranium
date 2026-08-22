import React from 'react';
import MaterialIcon from '../MaterialIcon';

interface StoragePanelProps {
    onClearStorage: (type: 'screenshots' | 'cookies') => void;
    workspacePath: string;
    workspaceLoading: boolean;
    workspaceSaving: boolean;
    onSaveWorkspacePath: (path: string) => Promise<void>;
}

const StoragePanel: React.FC<StoragePanelProps> = ({ onClearStorage, workspacePath, workspaceLoading, workspaceSaving, onSaveWorkspacePath }) => {
    const [draftPath, setDraftPath] = React.useState(workspacePath);

    React.useEffect(() => setDraftPath(workspacePath), [workspacePath]);

    return (
        <div className="glass-card p-8 rounded-[40px] space-y-6">
            <div className="flex items-center gap-4 mb-2">
                <div className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center text-gray-400"><MaterialIcon name="delete" className="text-xl" /></div>
                <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-widest">Storage</h3>
                    <p className="text-xs text-gray-500 uppercase tracking-widest mt-1">Manage stored data</p>
                </div>
            </div>
            <div className="space-y-3">
                <div>
                    <h4 className="text-sm font-bold text-white uppercase tracking-widest">Task workspace</h4>
                    <p className="text-xs text-gray-500 mt-1">All saved tasks and flows are loaded from this folder.</p>
                </div>
                <div className="flex items-center gap-3">
                    <input
                        value={draftPath}
                        onChange={e => setDraftPath(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') onSaveWorkspacePath(draftPath); }}
                        disabled={workspaceLoading || workspaceSaving}
                        aria-label="Task workspace path"
                        placeholder="/path/to/task-workspace"
                        className="flex-1 rounded-2xl theme-input border theme-border px-4 py-3 text-xs font-mono theme-text focus:outline-none focus:border-white disabled:opacity-50"
                    />
                    <button
                        type="button"
                        onClick={() => onSaveWorkspacePath(draftPath)}
                        disabled={workspaceLoading || workspaceSaving || !draftPath.trim()}
                        className="px-6 py-3 rounded-2xl text-xs font-bold uppercase tracking-widest theme-accent-bg hover:bg-blue-400 transition-all disabled:opacity-50"
                    >
                        {workspaceLoading ? 'Loading…' : workspaceSaving ? 'Saving…' : 'Save path'}
                    </button>
                </div>
            </div>
            <div className="flex gap-4">
                <button
                    type="button"
                    onClick={() => onClearStorage('screenshots')}
                    aria-label="Clear all captures"
                    title="Clear all captures"
                    className="flex-1 px-6 py-4 bg-red-500/5 border border-red-500/10 text-red-400 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-red-500/10 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
                >
                    Clear Captures
                </button>
                <button
                    type="button"
                    onClick={() => onClearStorage('cookies')}
                    aria-label="Reset all cookies"
                    title="Reset all cookies"
                    className="flex-1 px-6 py-4 bg-yellow-500/5 border border-yellow-500/10 text-yellow-400 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-yellow-500/10 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500/50"
                >
                    Reset Cookies
                </button>
            </div>
        </div>
    );
};

export default StoragePanel;
