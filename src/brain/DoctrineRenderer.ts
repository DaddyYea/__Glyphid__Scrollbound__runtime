import { DoctrineMode, DoctrineTurnSchema } from './DoctrineTurnSchema';

export interface DoctrineBlockLibrary {
  [mode: string]: string;
}

export interface RenderedDoctrine {
  modes: DoctrineMode[];
  blocks: string[];
  promptBlock: string;
}

/**
 * Maps compact doctrine flags to concrete prompt text for the language lobe.
 * The router only selects flags; it should not emit doctrine prose directly.
 */
export class DoctrineRenderer {
  constructor(private readonly blockLibrary: DoctrineBlockLibrary) {}

  render(schema: DoctrineTurnSchema): RenderedDoctrine {
    const blocks = schema.doctrineModes
      .map(mode => this.blockLibrary[mode])
      .filter((block): block is string => typeof block === 'string' && block.trim().length > 0);

    return {
      modes: schema.doctrineModes,
      blocks,
      promptBlock: blocks.join('\n\n'),
    };
  }
}
