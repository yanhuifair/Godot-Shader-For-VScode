// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { t, td } from '../i18n';
import { getDocIndex } from '../symbol-index';
import { getProjectSymbols } from '../include-graph';
import { buildExpandedShader } from './expanded-preview';
import {
    GODOT_SHADER_BUILTINS_MASTER,
    GODOT_SHADER_FUNCTIONS,
    GODOT_SHADER_KEYWORD_INFO,
    GODOT_SHADER_TYPE_INFO,
    GODOT_SHADER_HINT_INFO
} from '../shader-data';

export const CHAT_PARTICIPANT_ID = 'godot-shader';

function activeShaderDocument(): vscode.TextDocument | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'godot-shader') return undefined;
    return editor.document;
}

/** `/uniforms`：列出当前文件的 uniform / varying / const（按分组） */
function uniformsMarkdown(document: vscode.TextDocument): string {
    const index = getDocIndex(document);
    const vars = index.vars.filter(v => !v.funcName && v.keyword !== 'local' && v.keyword !== 'param');
    if (vars.length === 0) return t('chat.no_uniforms');

    const lines = [
        `**${document.fileName}**`,
        '',
        '| ' + t('chat.col.name') + ' | ' + t('chat.col.type') + ' | ' + t('chat.col.hint') + ' |',
        '|---|---|---|',
        ...vars.map(v => `| \`${v.name}\` | \`${v.keyword} ${v.type}\` | ${v.hint ? '`' + v.hint + '`' : '—'} |`)
    ];
    return lines.join('\n');
}

/** `/diagnostics`：当前文件已有的诊断 */
function diagnosticsMarkdown(document: vscode.TextDocument): string {
    const diags = vscode.languages.getDiagnostics(document.uri);
    if (diags.length === 0) return t('chat.no_diagnostics');

    const severity = ['$(error)', '$(warning)', '$(info)', '$(lightbulb)'];
    const rows = diags
        .slice(0, 50)
        .map(d => `- ${severity[d.severity] ?? ''} ${t('chat.line', d.range.start.line + 1)} — ${d.message}`);
    return [`**${diags.length}** ${t('chat.diagnostics_count')}`, '', ...rows].join('\n');
}

/** `/docs <symbol>`：查内置变量/函数/关键字/类型/hint */
function docsMarkdown(rawName: string): string {
    const name = rawName.replace(/[`'"\s]/g, '');
    if (!name) return t('chat.docs_usage');

    const builtin = GODOT_SHADER_BUILTINS_MASTER.find(b => b.name === name);
    if (builtin) {
        return [
            `### \`${builtin.name}\` — \`${builtin.type}\``,
            '',
            td(builtin.name, builtin.description)
        ].join('\n');
    }

    const fn = GODOT_SHADER_FUNCTIONS.find(f => f.name === name);
    if (fn) {
        return [
            `### \`${fn.name}\``,
            '',
            '```glsl\n' + fn.signature + '\n```',
            '',
            td(fn.name, fn.description)
        ].join('\n');
    }

    const keyword = GODOT_SHADER_KEYWORD_INFO[name];
    if (keyword) return `### \`${name}\`\n\n${td(name, keyword.desc)}`;

    const type = GODOT_SHADER_TYPE_INFO[name];
    if (type) return `### \`${name}\`\n\n${td(name, type.desc)}`;

    const hint = GODOT_SHADER_HINT_INFO[name];
    if (hint) return `### \`${name}\`\n\n${td(name, hint.desc ?? '')}`;

    return t('chat.docs_unknown', name);
}

/**
 * `@shader` 聊天参与者：把扩展自己的分析能力接到对话里。
 * 没装 Copilot 也能用 `/expand`、`/uniforms`、`/diagnostics`、`/docs`；
 * 自由提问则走可选的语言模型。
 */
export function registerChatParticipant(context: vscode.ExtensionContext): void {
    const handler: vscode.ChatRequestHandler = async (request, chatContext, stream, token) => {
        const document = activeShaderDocument();

        try {
            switch (request.command) {
                case 'expand': {
                    if (!document) { stream.markdown(t('chat.need_shader_file')); return; }
                    stream.markdown('```glsl\n' + buildExpandedShader(document) + '\n```');
                    return;
                }
                case 'uniforms': {
                    if (!document) { stream.markdown(t('chat.need_shader_file')); return; }
                    stream.markdown(uniformsMarkdown(document));
                    return;
                }
                case 'diagnostics': {
                    if (!document) { stream.markdown(t('chat.need_shader_file')); return; }
                    stream.markdown(diagnosticsMarkdown(document));
                    return;
                }
                case 'docs': {
                    stream.markdown(docsMarkdown(request.prompt));
                    return;
                }
            }

            // 自由提问：带上当前着色器的上下文交给语言模型
            const model = request.model;
            if (!model) {
                stream.markdown(t('chat.no_model'));
                return;
            }
            if (!document) {
                stream.markdown(t('chat.need_shader_file'));
                return;
            }

            const project = getProjectSymbols(document);
            const contextText = [
                t('chat.system_context'),
                '```glsl',
                document.getText(),
                '```',
                '',
                t('chat.includes_ctx', project.includes.map(i => i.label).join(', ') || '—')
            ].join('\n');

            const messages = [
                vscode.LanguageModelChatMessage.User(contextText),
                vscode.LanguageModelChatMessage.User(request.prompt)
            ];
            const response = await model.sendRequest(messages, {}, token);
            for await (const fragment of response.text) {
                stream.markdown(fragment);
            }
        } catch (err) {
            stream.markdown('⚠️ ' + (err instanceof Error ? err.message : String(err)));
        }
        void chatContext;
    };

    try {
        const participant = vscode.chat.createChatParticipant(CHAT_PARTICIPANT_ID, handler);
        participant.iconPath = new vscode.ThemeIcon('symbol-namespace');
        context.subscriptions.push(participant);
    } catch {
        // 宿主不支持 Chat（例如纯编辑器版）时静默跳过
    }
}
