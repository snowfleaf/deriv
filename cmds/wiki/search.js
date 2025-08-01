import {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags
} from 'discord.js';

import { botLimits } from '../../util/defaults.js';
import { got, escapeFormatting, splitMessage } from '../../util/functions.js';

const { search: searchLimit } = botLimits;

/**
 * Searches a wiki.
 * @param {import('../../util/i18n.js').default} lang - The user language.
 * @param {import('discord.js').Message|import('discord.js').ChatInputCommandInteraction} msg - The Discord message.
 * @param {String} searchterm - The searchterm.
 * @param {import('../../util/wiki.js').default} wiki - The wiki for the search.
 * @param {Object} query - The siteinfo from the wiki.
 * @param {import('discord.js').MessageReaction} reaction - The reaction on the message.
 * @param {String} spoiler - If the response is in a spoiler.
 * @param {Boolean} noEmbed - If the response should be without an embed.
 * @returns {Promise<{reaction?: WB_EMOJI, message?: Object}>}
 */
export default function mw_search(lang, msg, searchterm, wiki, query, reaction, spoiler, noEmbed) {
	if ( searchterm.length > 250 ) {
		searchterm = searchterm.substring(0, 250).trim();
		msg?.fetchReply?.().then(message => message?.reactEmoji?.(WB_EMOJI.warning), console.error);
		msg?.reactEmoji?.(WB_EMOJI.warning);
	}

	const pagelink = wiki.toLink('Special:Search', { search: searchterm, fulltext: 1 });
	let resultText = `<${pagelink}>`;
	let description = [];
	let footer = '';
	let querypage = (Object.values((query.pages || {}))?.[0] || { title: '', ns: 0, invalid: '' });
	const limit = searchLimit[(patreonGuildsPrefix.has(msg.guildId) ? 'patreon' : 'default')];

	return got.get(`${wiki}api.php?action=query&titles=Special:Search&list=search&srinfo=totalhits&srprop=redirecttitle|sectiontitle&srnamespace=4|12|14|${(querypage.ns >= 0 ? querypage.ns + '|' : '')}${wiki.namespaces.content.map(ns => ns.id).join('|')}&srlimit=${limit}&srsearch=${encodeURIComponent(searchterm)}&format=json`, {
		context: { guildId: msg.guildId }
	}).then(response => {
		const body = response.body;
		if (body?.warnings) console.warn(body.warnings);
		if (response.statusCode !== 200 || !body?.query?.search || body.batchcomplete === undefined) {
			console.error('- Error while getting the search results:', body?.error?.info);
			return;
		}
		// If less than limit, do fallback search
		if (body.query.search.length < limit) {
			return got.get(`${wiki}api.php?action=query&list=search&srwhat=text&srinfo=totalhits&srprop=redirecttitle|sectiontitle&srnamespace=4|12|14|${(querypage.ns >= 0 ? querypage.ns + '|' : '')}${wiki.namespaces.content.map(ns => ns.id).join('|')}&srlimit=${limit}&srsearch=${encodeURIComponent(searchterm)}&format=json`, {
				context: { guildId: msg.guildId }
			}).then(tresponse => {
				const tbody = tresponse.body;
				if (tbody?.warnings) console.warn(tbody.warnings);
				if (tresponse.statusCode !== 200 || !tbody?.query?.search || tbody.batchcomplete === undefined) {
					console.error('- Error while getting text fallback results:', tbody?.error?.info);
					return;
				}
				body.query.search.push(...tbody.query.search.filter(tresult => {
					return !body.query.search.some(result => result.pageid === tresult.pageid);
				}).slice(0, limit - body.query.search.length));
				if (body.query.searchinfo && tbody.query.searchinfo) {
					body.query.searchinfo.totalhits += tbody.query.searchinfo.totalhits;
				}
			}).then(() => body);
		}
		return body;
	}).then(body => {
		if (!body?.query?.search) return;

		if (body.query.pages?.['-1']?.title) {
			resultText = `<${wiki.toLink(body.query.pages['-1'].title, { search: searchterm, fulltext: 1 })}>`;
		}

		let hasExactMatch = false;

		body.query.search.forEach(result => {
			let text = '• ';
			let bold = '';

			if (result.title.replace(/[_-]/g, ' ').toLowerCase() === querypage.title.replaceAll('-', ' ').toLowerCase()) {
				bold = '**';
				hasExactMatch = true;
				if (query.redirects?.[0]) {
					if (query.redirects[0].tofragment && !result.sectiontitle) {
						result.sectiontitle = query.redirects[0].tofragment;
					}
					if (!result.redirecttitle) result.redirecttitle = query.redirects[0].from;
				}
			}

			text += bold + `[${escapeFormatting(result.title)}](<${wiki.toLink(result.title, '', '', true)}>)`;
			if (result.sectiontitle) {
				text += ` § [${escapeFormatting(result.sectiontitle)}](<${wiki.toLink(result.title, '', result.sectiontitle, true)}>)`;
			}
			if (result.redirecttitle) {
				text += ` (⤷ [${escapeFormatting(result.redirecttitle)}](<${wiki.toLink(result.redirecttitle, 'redirect=no', '', true)}>))`;
			}
			text += bold;

			description.push(text);
		});

		if (!hasExactMatch) {
			if (query.interwiki?.[0]) {
				let text = `• **⤷ __[${escapeFormatting(query.interwiki[0].title)}](<${query.interwiki[0].url}>)__`;
				if (query.redirects?.[0]) {
					text += ` (⤷ [${escapeFormatting(query.redirects[0].from)}](<${wiki.toLink(query.redirects[0].from, 'redirect=no', '', true)}>))`;
				}
				text += '**';
				description.unshift(text);
			} else if (querypage.invalid === undefined && (querypage.missing === undefined || querypage.known !== undefined)) {
				let text = `• **[${escapeFormatting(querypage.title)}](<${wiki.toLink(querypage.title, '', '', true)}>)`;
				if (query.redirects?.[0]) {
					if (query.redirects[0].tofragment) {
						text += ` § [${escapeFormatting(query.redirects[0].tofragment)}](<${wiki.toLink(querypage.title, '', query.redirects[0].tofragment, true)}>)`;
					}
					text += ` (⤷ [${escapeFormatting(query.redirects[0].from)}](<${wiki.toLink(query.redirects[0].from, 'redirect=no', '', true)}>))`;
				}
				text += '**';
				description.unshift(text);
			}
		}

		if (body.query.searchinfo) {
			footer = lang.get('search.results', body.query.searchinfo.totalhits.toLocaleString(lang.get('dateformat')), body.query.searchinfo.totalhits);
		}
	}).then(() => {
		// Create Components V2 Message
		const components = [
			new TextDisplayBuilder().setContent(`🔍 ${spoiler}[View on the wiki](${resultText})${spoiler}`),
			new ContainerBuilder().addTextDisplayComponents(
				...(description.length
					? splitMessage(description.join('\n')).map(desc =>
						new TextDisplayBuilder().setContent(desc)
					)
					: [new TextDisplayBuilder().setContent(lang.get('search.noresults'))]
				)
			)
		];

		if (footer) {
			components.push(new TextDisplayBuilder().setContent('-# ' + footer));
		}

		return {
			message: {
				flags: MessageFlags.IsComponentsV2,
				components
			}
		};
	}, error => {
		console.error('- Error while getting search results:', error);
	});
}
