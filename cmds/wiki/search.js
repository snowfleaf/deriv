import { EmbedBuilder } from 'discord.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';

import { botLimits } from '../../util/defaults.js';
import { got, escapeFormatting, splitMessage, log_error, log_warning } from '../../util/functions.js';

const { search: searchLimit } = botLimits;

export default async function mw_search(lang, msg, searchterm, wiki, query, reaction, spoiler, noEmbed = false) {
  if (searchterm.length > 250) {
    searchterm = searchterm.slice(0, 250).trim();
    await msg.fetchReply?.().then(reply => reply.react(WB_EMOJI.warning)).catch(log_error);
  }

  let pagelink = wiki.toLink('Special:Search', { search: searchterm, fulltext: 1 });
  let resultText = `<${pagelink}>`;

  let embed = null;
  if (!noEmbed) {
    embed = new EmbedBuilder()
      .setAuthor({ name: query.general.sitename })
      .setTitle(`\`${searchterm}\``)
      .setURL(pagelink);
  } else {
    resultText += `\n\n**\`${searchterm}\`**`;
  }

  const querypage = Object.values(query.pages || {})?.[0] || { title: '', ns: 0, invalid: '' };
  const limit = searchLimit[(patreonGuildsPrefix.has(msg.guildId) ? 'patreon' : 'default')];

  let body;
  try {
    const response = await got.get(`${wiki}api.php?action=query&titles=Special:Search&list=search&srinfo=totalhits&srprop=redirecttitle|sectiontitle&srnamespace=4|12|14|${querypage.ns >= 0 ? querypage.ns + '|' : ''}${wiki.namespaces.content.map(ns => ns.id).join('|')}&srlimit=${limit}&srsearch=${encodeURIComponent(searchterm)}&format=json`, {
      context: { guildId: msg.guildId }
    });
    body = response.body;
    if (body?.warnings) log_warning(body.warnings);

    if (response.statusCode !== 200 || !body?.query?.search || body.batchcomplete === undefined) {
      console.log(`- ${response.statusCode}: Error while getting the search results: ${body?.error?.info}`);
      return;
    }

    if (body.query.search.length < limit) {
      const tresponse = await got.get(`${wiki}api.php?action=query&list=search&srwhat=text&srinfo=totalhits&srprop=redirecttitle|sectiontitle&srnamespace=4|12|14|${querypage.ns >= 0 ? querypage.ns + '|' : ''}${wiki.namespaces.content.map(ns => ns.id).join('|')}&srlimit=${limit}&srsearch=${encodeURIComponent(searchterm)}&format=json`, {
        context: { guildId: msg.guildId }
      });
      const tbody = tresponse.body;
      if (tbody?.warnings) log_warning(tbody.warnings);
      if (tresponse.statusCode === 200 && tbody?.query?.search) {
        body.query.search.push(...tbody.query.search.filter(tresult => {
          return !body.query.search.some(result => result.pageid === tresult.pageid);
        }).slice(0, limit - body.query.search.length));
        if (body.query.searchinfo && tbody.query.searchinfo) {
          body.query.searchinfo.totalhits += tbody.query.searchinfo.totalhits;
        }
      }
    }
  } catch (error) {
    console.log(`- Error while getting the search results: ${error}`);
    return;
  }

  if (!body?.query?.search) return;

  const description = [];
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
      text += ` (⤷ [${escapeFormatting(result.redirecttitle)}](<${wiki.toLink(result.redirecttitle, 'redirect=no', '', true)}>)`;
    }
    text += bold;
    description.push(text);
  });

  if (!hasExactMatch) {
    if (query.interwiki?.[0]) {
      let text = '• **⤷ __[' + escapeFormatting(query.interwiki[0].title) + '](<' + query.interwiki[0].url + '>)__';
      if (query.redirects?.[0]) {
        text += ' (⤷ [' + escapeFormatting(query.redirects[0].from) + '](<' + wiki.toLink(query.redirects[0].from, 'redirect=no', '', true) + '>))';
      }
      text += '**';
      description.unshift(text);
    } else if (querypage.invalid === undefined && (querypage.missing === undefined || querypage.known !== undefined)) {
      let text = '• **[' + escapeFormatting(querypage.title) + '](<' + wiki.toLink(querypage.title, '', '', true) + '>)';
      if (query.redirects?.[0]) {
        if (query.redirects[0].tofragment) {
          text += ' § [' + escapeFormatting(query.redirects[0].tofragment) + '](<' + wiki.toLink(querypage.title, '', query.redirects[0].tofragment, true) + '>)';
        }
        text += ' (⤷ [' + escapeFormatting(query.redirects[0].from) + '](<' + wiki.toLink(query.redirects[0].from, 'redirect=no', '', true) + '>))';
      }
      text += '**';
      description.unshift(text);
    }
  }

  const footer = body.query.searchinfo
    ? lang.get('search.results', body.query.searchinfo.totalhits.toLocaleString(lang.get('dateformat')), body.query.searchinfo.totalhits)
    : '';

  if (!noEmbed) {
    if (description.length) embed.setDescription(splitMessage(description.join('\n'))[0]);
    if (footer) embed.setFooter({ text: footer });
  } else {
    if (description.length) resultText += '\n' + splitMessage(description.join('\n'), { maxLength: 1990 - resultText.length - footer.length })[0];
    if (footer) resultText += '\n' + footer;
  }

  if (!noEmbed) {
    const components = body.query.search.slice(0, 5).map(result => {
      const title = result.title;
      const pageUrl = wiki.toLink(title, '', '', true);
      const displayTitle = escapeFormatting(title);

      const button = new ButtonBuilder()
        .setLabel(displayTitle)
        .setStyle(ButtonStyle.Link)
        .setURL(pageUrl);

      return new ActionRowBuilder().addComponents(button);
    });

    return {
      message: {
        embeds: [embed],
        components,
        flags: 0
      }
    };
  } else {
    return {
      message: {
        content: '🔍 ' + spoiler + resultText + spoiler
      }
    };
  }
}
