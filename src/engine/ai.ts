export interface ImageService {
  generate(caption: string): Promise<string>;
}

export interface CaptionService {
  captionForImage(imageContent: string): Promise<string>;
  seedCaption(): Promise<string>;
}

export interface AIServices {
  image: ImageService;
  caption: CaptionService;
}

const SEED_CAPTIONS = [
  'a cat doing taxes',
  'a dog astronaut',
  'a robot baking bread',
  'a penguin surfing',
];

export class MockAI implements AIServices {
  private seedIndex = 0;

  image: ImageService = {
    generate: async (caption: string) => `mock-image://${encodeURIComponent(caption)}`,
  };

  caption: CaptionService = {
    captionForImage: async (imageContent: string) => {
      const inner = decodeURIComponent(imageContent.replace('mock-image://', ''));
      return `a drawing of ${inner}`;
    },
    seedCaption: async () => SEED_CAPTIONS[this.seedIndex++ % SEED_CAPTIONS.length],
  };
}
