import * as fs from 'fs/promises';
import * as path from 'path';
import * as Handlebars from 'handlebars';


const cache = new Map<
    string,
    Handlebars.TemplateDelegate
>();

export async function renderTemplate(
    template: string, context: Record<string, any>,
): Promise<string> {
    let compiled = cache.get(template);

    if (!compiled) {
        const filePath = path.join(
            process.cwd(),
            'src',
            'infrastructure',
            'mails',
            'templates',
            `${template}.hbs`,
        );

        const source = await fs.readFile(
            filePath,
            'utf8',
        );

        compiled = Handlebars.compile(source);

        cache.set(template, compiled);
    }

    return compiled(context);
}