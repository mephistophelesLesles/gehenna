// Chapter 1 as a visual novel. The text lives on the server, so it only reaches the browser once the chapter is opened.
// t = [start, end] in seconds inside vn/ch1-voice.mp3 (the Japanese voice). Each page plays only its own piece of the voice.
// Optional: kind (time | emph | insult | shout), image (the picture fades in on this page), after (extra quiet seconds after the page).
module.exports = {
  voice: 'vn/ch1-voice.mp3',
  ominous: 'vn/ch1-ominous.mp3',
  image: 'vn/ch1-scene.webp',
  imageAlt: 'A girl in a white frilled dress cries out in the moonlight, clutching the hem of her mother’s dress.',
  pages: [
    { t: [2.65, 6.97], lines: ['I love my mother.', 'In everyone’s eyes, she was the most beloved person in the world.'] },
    { t: [7.67, 13.53], lines: ['She was the one I looked up to, the one I quietly prayed I would become someday.'] },
    { t: [14.27, 18.68], lines: ['A perfect face.', 'A perfect smile.', 'A perfect laugh.'] },
    { t: [19.69, 21.97], lines: ['There was almost nothing she didn’t know.'] },
    { t: [22.73, 26.61], lines: ['To everyone, she was, without a doubt… a perfect being.'] },
    { t: [27.66, 30.16], kind: 'emph', lines: ['A PERFECT BEING WHO GAVE BIRTH TO THE IMPERFECT ME.'] },
    { t: [30.85, 35.05], kind: 'insult', lines: ['What a waste of talent.', 'What a disappointment.', 'Such a slut.'] },
    { t: [36.29, 41.80], lines: ['I still wonder what kind of face my mother made when she heard those words.'] },
    { t: [42.93, 47.07], lines: ['I was an unwanted child… I knew that.'] },
    { t: [48.02, 54.01], lines: ['But even so, I was certain of one thing: my mother loved me most of all.'] },
    { t: [55.65, 64.48], lines: ['No matter how many times I was pushed away, no matter how many times I was rejected, she would hold me close and sing me a lullaby just like how she often do.'] },
    { t: [65.48, 66.31], after: 2.6, lines: ['Or so I believed.'] },
    { t: [67.30, 70.34], kind: 'time', lines: ['12:00 AM.', 'A strange noise drifted through my mother’s house.'] },
    { t: [70.94, 73.93], lines: ['Strange. Was she still awake at this hour? That wouldn’t do.'] },
    { t: [74.43, 79.19], lines: ['She had work tomorrow, and I couldn’t let her wear herself out.'] },
    { t: [80.24, 84.15], lines: ['“Mother, it’s time to sleep,” I called softly.'] },
    { t: [84.85, 88.47], image: true, lines: ['Then I saw her, and the breath left my chest.'] },
    { t: [89.55, 95.60], lines: ['A pale woman hung at the window, the white moon spilling down behind her.'] },
    { t: [96.63, 102.01], lines: ['“Mother, please, come down,” I begged. “I’m begging you.”'] },
    { t: [102.69, 103.55], lines: ['No answer.'] },
    { t: [103.96, 106.35], kind: 'shout', lines: ['“SOMEBODY HELP! PLEASE!”'] },
    { t: [107.24, 110.81], lines: ['How foolish of me. There was no one else here.'] },
    { t: [111.44, 115.73], lines: ['Only my mother and me, alone in this abandoned place.'] },
    { t: [116.72, 118.62], after: 0.8, lines: ['No one heard my voice.'] },
    { t: [119.29, 125.40], after: 1.2, lines: ['And even if someone had, I knew they couldn’t have saved her either.'] }
  ]
};
