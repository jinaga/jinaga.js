import { HashMap } from '../fact/hydrate';
import { FactRecord } from '../storage';
import { computeStringHash } from '../util/encoding';
import { flatten } from '../util/fn';
import { getPredecessors } from './memory-store';


export function formatDot(records: FactRecord[]): string[] {
    const prefix = [
        'digraph {',
        'rankdir=BT',
        'node [shape=none]'
    ];
    const arrows = flatten(records, record => {
        const node = ['"' + record.hash + '" [label=<' + factLabel(record) + '>]'];
        let edges: string[] = [];
        for (const role in record.predecessors) {
            const predecessors = getPredecessors(record, role);
            const roleEdges = predecessors.map(predecessor =>
                '"' + record.hash + '" -> "' + predecessor.hash + '" [label="' + role + '"]');
            edges = edges.concat(roleEdges);
        }
        return node.concat(edges);
    });
    const suffix = [
        '}'
    ];
    return prefix.concat(arrows, suffix);
}

function factLabel(record: FactRecord) {
    return '<TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0">' + factRows(record.type, record.fields) + '</TABLE>';
}

function factRows(type: string, fields: HashMap) {
    let rows: string = '<TR><TD COLSPAN="2">' + escapeHTML(type) + '</TD></TR>';
    for (const field in fields) {
        rows += fieldRow(field, fields[field]);
    }
    return rows;
}

function fieldRow(name: string, value: any) {
    return '<TR><TD>' + escapeHTML(name) + '</TD><TD>' + escapeHTML(shorten(JSON.stringify(value))) + '</TD></TR>';
}

function shorten(value: string) {
    if (value.startsWith('"-----BEGIN RSA PUBLIC KEY-----')) {
        const b64 = computeStringHash(value);
        return b64.substr(0, 16);
    }
    else if (value.length > 100) {
        return value.substr(0, 50) + '...' + value.substr(value.length - 47);
    }
    else {
        return value;
    }
}

function escapeHTML(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}