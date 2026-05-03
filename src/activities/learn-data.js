/**
 * @file Learn-mode part metadata.
 *
 * 15 microscope parts the student must identify. Each entry's `name`
 * matches a `Microscope_*` mesh / group .name set by the procedural
 * builder in src/microscope/build.js, so a raycast hit can be mapped
 * back to its metadata in O(1).
 *
 * To extend (e.g. add a new turret style or a slide-holder accessory):
 *   1. Give the new part a `Microscope_*` name in build.js.
 *   2. Append a row here with mn / en / desc.
 *   3. Update the side-panel layout in learn.js if the count changes.
 */

export const PARTS = [
	{
		name: 'Microscope_Eyepiece',
		mn: 'Нүдний линз (Окуляр)',
		en: 'Eyepiece / Ocular',
		desc:
			'Хэрэглэгч нүдээ ойртуулдаг хэсэг. ' +
			'Ихэвчлэн 10× томруулалттай линз агуулдаг.',
	},
	{
		name: 'Microscope_EyepieceTube',
		mn: 'Дуран',
		en: 'Eyepiece tube',
		desc:
			'Объективийн дүрсийг нүдний линз рүү дамжуулна.',
	},
	{
		name: 'Microscope_Nosepiece',
		mn: 'Сэлгүүр',
		en: 'Nosepiece / Revolving turret',
		desc:
			'4-объектив линзүүдийг солих, сэлгэх хэсэг.',
	},
	{
		name: 'Microscope_Objective_4x',
		mn: '4× линз (улаан тууз)',
		en: '4× objective',
		desc:
			'Хамгийн бага өсгөлт. ' +
			'Дүрсийг олоход ашиглах хамгийн анхны объектив линз.',
	},
	{
		name: 'Microscope_Objective_10x',
		mn: '10× линз (шар тууз)',
		en: '10× objective',
		desc:
			' Харж буй зүйлийг дараагийн түвшинд томруулна.' +
			'Эс, ургамлын эдийн ерөнхий бүтцийг харна.',
	},
	{
		name: 'Microscope_Objective_40x',
		mn: '40× линз (цэнхэр тууз)',
		en: '40× objective',
		desc:
			'Эс судлалын гол өсгөлт. ' +
			'Эсийн дотоод бүтцийг тодорхой харах боломжтой.',
	},
	{
		name: 'Microscope_Objective_100x',
		mn: '100× линз (цагаан тууз, иммерсийн)',
		en: '100× oil-immersion objective',
		desc:
			'Хамгийн их өсгөлт. Заавал иммерсийн тос ашигладаг, ' +
			'маш жижиг бүтэц болох бактерийн эсийг харах боломжтой.',
	},
	{
		name: 'Microscope_Stage',
		mn: 'Тавцан',
		en: 'Stage',
		desc:
			'Бэлдмэлийг тавих хэсэг. ' +
			'Дунд нь гэрэл нэвтрэх нүх бий.',
	},
	{
		name: 'Microscope_CoarseKnob',
		mn: 'Том фокусны товч',
		en: 'Coarse focus knob',
		desc:
			'Тавцанг хурдан дээш доош хөдөлгөнө. ' +
			'Зөвхөн 4× ба 10× өсгөлттэй үед ашиглана.',
	},
	{
		name: 'Microscope_FineKnob',
		mn: 'Нарийн фокусны товч',
		en: 'Fine focus knob',
		desc:
			'Дүрсний фокусыг нарийн тохируулна. ' +
			'40× ба 100×-д ашиглана.',
	},
	{
		name: 'Microscope_Diaphragm',
		mn: 'ӨРЦ (Диафрагм)',
		en: 'Iris diaphragm',
		desc:
			'Тавцангын доор байрлана. ' +
			'Гэрлийн хэмжээг тохируулна — нээж, хааж боломжтой.',
	},
	{
		name: 'Microscope_LightSource',
		mn: 'Гэрлийн эх үүсвэр',
		en: 'Light source / LED',
		desc:
			'Микроскопын сууринд байрлана. ' +
			'Бэлдмэлийг доороос гэрэлтүүлж дүрс үүсгэдэг.',
	},
	{
		name: 'Microscope_Arm',
		mn: 'Бариул',
		en: 'Arm',
		desc:
			'Дээд хэсгийг суурьтай холбосон босоо тулгуур. ' +
			'Микроскоп зөөхдөө хоёр гараараа суурь, бариулыг хамт барина.',
	},
	{
		name: 'Microscope_Base',
		mn: 'Суурь',
		en: 'Base / Foot',
		desc:
			'Микроскопын хатуу суурь. ' +
			'Тэгш гадаргуу дээр тавих шаардлагатай.',
	},
	{
		name: 'Microscope_OnOffSwitch',
		mn: 'Унтраалга',
		en: 'On/Off switch',
		desc: 'Гэрлийг асаах, унтраах товч.',
	},
];

/** Quick lookup by part .name. */
export const PART_BY_NAME = new Map(PARTS.map((p) => [p.name, p]));
