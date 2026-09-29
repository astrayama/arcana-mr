/**
 * Names for the spots in a spread you build yourself, grouped for the
 * picker, each with what it asks (shown with the card's meaning). Reflective,
 * never predictive. Every name fits on a label (18 characters or fewer).
 */

export interface PositionName {
  label: string;
  meaning: string;
}

export interface NameGroup {
  title: string;
  names: readonly PositionName[];
}

export const NAME_GROUPS: readonly NameGroup[] = [
  {
    title: 'Time',
    names: [
      { label: 'Past', meaning: 'What has shaped this moment.' },
      { label: 'Present', meaning: 'Where you stand right now.' },
      { label: 'Future', meaning: 'Where things are leaning, and what you can still shape.' },
      { label: 'Recent past', meaning: 'What is moving out of the picture.' },
      { label: 'Next steps', meaning: 'What is starting to take shape.' },
      { label: 'Root', meaning: 'What lies underneath all of this.' },
      { label: 'Beginning', meaning: 'How this started.' },
      { label: 'Middle', meaning: 'Where things are in the thick of it.' },
      { label: 'Ending', meaning: 'What is completing or closing.' },
      { label: 'What is fading', meaning: 'What is losing its hold on you.' },
      { label: 'What is growing', meaning: 'What is gathering strength in you.' },
      { label: 'This season', meaning: 'The feeling of this stretch of your life.' },
    ],
  },
  {
    title: 'You',
    names: [
      { label: 'You', meaning: 'How you are showing up.' },
      { label: 'Mind', meaning: 'What your thoughts keep circling.' },
      { label: 'Body', meaning: 'What your body is asking for.' },
      { label: 'Spirit', meaning: 'What feeds your sense of meaning.' },
      { label: 'Heart', meaning: 'What you feel most deeply about this.' },
      { label: 'Strength', meaning: 'What you can lean on in yourself.' },
      { label: 'Blind spot', meaning: 'What might be hard for you to see.' },
      { label: 'Hopes', meaning: 'What you are hoping for.' },
      { label: 'Fears', meaning: 'What you are worried about.' },
      { label: 'Needs', meaning: 'What you need right now.' },
      { label: 'Gifts', meaning: 'What you bring that is uniquely yours.' },
      { label: 'Shadow', meaning: 'A part of you asking to be understood.' },
    ],
  },
  {
    title: 'Situation',
    names: [
      { label: 'Challenge', meaning: 'What crosses you or complicates things.' },
      { label: 'Obstacle', meaning: 'What seems to be in the way.' },
      { label: 'Foundation', meaning: 'What this is built on.' },
      { label: 'Hidden', meaning: 'What is at work below the surface.' },
      { label: 'Others', meaning: 'The people and pressures around you.' },
      { label: 'Home', meaning: 'Where you come from and where you rest.' },
      { label: 'Work', meaning: 'Your work and what it asks of you.' },
      { label: 'Relationships', meaning: 'Your closest bonds.' },
      { label: 'Resources', meaning: 'Time, money, and energy you can draw on.' },
      { label: 'Surroundings', meaning: 'The places and atmosphere around you.' },
      { label: 'One path', meaning: 'What one option holds for you.' },
      { label: 'Another path', meaning: 'What another option holds for you.' },
    ],
  },
  {
    title: 'Guidance',
    names: [
      { label: 'Advice', meaning: 'A way of approaching this worth trying.' },
      { label: 'Lesson', meaning: 'What this has to teach you.' },
      { label: 'What helps', meaning: 'What supports you right now.' },
      { label: 'Let go of', meaning: 'What you might be ready to release.' },
      { label: 'Aspiration', meaning: 'What you are reaching for.' },
      { label: 'Direction', meaning: 'Where things lean if nothing changes, which you can still shape.' },
      { label: 'Question', meaning: 'A question worth carrying with you.' },
      { label: 'Reminder', meaning: 'Something worth remembering.' },
      { label: 'Gift', meaning: 'Something good being offered to you.' },
      { label: 'Focus', meaning: 'Where to put your attention.' },
      { label: 'Wish', meaning: 'What you would ask for, if you let yourself.' },
      { label: 'Your card', meaning: 'What wants your attention right now.' },
    ],
  },
];

const byLabel = new Map(NAME_GROUPS.flatMap((g) => g.names).map((n) => [n.label, n]));

/** What a spot asks, for a name from the picker (or a gentle default). */
export function meaningFor(label: string): string {
  return byLabel.get(label)?.meaning ?? 'What this card brings to your question.';
}

export function isKnownName(label: string): boolean {
  return byLabel.has(label);
}

/** Starting names for a spread of `count` cards, before the reader changes any. */
export function defaultNames(count: number): string[] {
  const presets: Record<number, string[]> = {
    1: ['Your card'],
    2: ['You', 'Challenge'],
    3: ['Past', 'Present', 'Future'],
    4: ['You', 'Challenge', 'What helps', 'Direction'],
    5: ['Present', 'Challenge', 'Root', 'Advice', 'Direction'],
  };
  if (presets[count]) return [...presets[count]];
  const pool = ['You', 'Heart', 'Mind', 'Body', 'Spirit', 'Hidden', 'Others', 'Challenge', 'Strength', 'Lesson', 'Advice', 'Direction'];
  return pool.slice(0, count);
}
