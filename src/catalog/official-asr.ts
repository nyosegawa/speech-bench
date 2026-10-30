import type { AsrModel } from './models.ts'
import type { PinnedFile } from './store.ts'

/**
 * The checkpoints of the speech recognition models measured in their official implementations through the
 * transformers, NeMo, ReazonSpeech k2 and VibeVoice adapters, each at the revision its files are pinned to, and their
 * entries.
 */

const checkpoint = (repo: string, revision: string, files: readonly [string, number, string][]): PinnedFile[] =>
  files.map(([file, bytes, sha256]) => ({ kind: 'model', repo, revision, file, bytes, sha256 }))

const WAV2VEC2_BASE = checkpoint('reazon-research/japanese-wav2vec2-base-rs35kh', '46afc596052b612293c8db256b3a69447a2f57dc', [
  ['added_tokens.json', 51, '4de0ae97b4959a8d86c933b0ec9afaf72a917ebf02d1693c1ccba1d34c575599'],
  ['config.json', 2_041, 'ce1cf984403e369ba3d9757e48850be2e6f3b931f72d54b9b725e5ba5621c6af'],
  ['model.safetensors', 386_749_964, 'f7e05abd4c9f98e7d311ab0c4904dac8cdde49290f6ac015e96d40e02df0312f'],
  ['preprocessor_config.json', 214, '60ca5a31e13f69ee2fbf147504c8676db5f6398fd7a6b12294341dff838edfcf'],
  ['special_tokens_map.json', 550, 'fe941423230c28a1b96e319effd1cb23982cadf1d27e2a62f6054313b6d3fc3f'],
  ['tokenizer_config.json', 89_531, '5ecf666fb5c77cb12d8ee420ae1c7321b4fc28d0f377baaff0d135529aad6822'],
  ['vocab.json', 46_399, '223300c979885b08b6a44f18b6b76cae49099c6de1a0bc2d5694a32827b3a7ab']
])
const WAV2VEC2_LARGE = checkpoint('reazon-research/japanese-wav2vec2-large-rs35kh', '2162c9edb97f362f7623d6b3a2e417458e879bca', [
  ['added_tokens.json', 51, '4de0ae97b4959a8d86c933b0ec9afaf72a917ebf02d1693c1ccba1d34c575599'],
  ['config.json', 2_044, '07c76a314b3968cb69f17139cd31eecfabaccc61d0224ae2e0500a7288665d84'],
  ['model.safetensors', 1_274_078_500, 'cc0228dfe1d939e541624c78911eafc7041698e1b2f4853de8a6364fb4557364'],
  ['preprocessor_config.json', 256, 'ffc72f475cd79680d5d659fbaefc691cdbcee5c9703a15faf708a5e91452a8d8'],
  ['special_tokens_map.json', 550, 'fe941423230c28a1b96e319effd1cb23982cadf1d27e2a62f6054313b6d3fc3f'],
  ['tokenizer_config.json', 89_573, 'c36b3a74819e8290b923327b9e1cddd2331cc08c2aca29cb379e0aad0cfb6ea9'],
  ['vocab.json', 46_399, '223300c979885b08b6a44f18b6b76cae49099c6de1a0bc2d5694a32827b3a7ab']
])
const HUBERT = checkpoint('reazon-research/japanese-hubert-base-k2-rs35kh', '30acf6f643914538edb15fc708f670a520478ea4', [
  ['config.json', 1_404, '02294d6fde9bde49473095b236689cab7cacc8a8eaa78ad856ce75314928863c'],
  ['model.safetensors', 393_599_760, '221e373f22a7007ca911d88774382fdf44c82eb609ba12c210086238df176a46'],
  ['preprocessor_config.json', 257, '617bd0950f8cc9ac4062e8c73a7be60305ca5790a243df55fa6f44fb671b55b1'],
  ['special_tokens_map.json', 107, '01cf5274c5e70dad1c5962022fa0ed902b37f95695d626ef58179d472c1cae5d'],
  ['tokenizer_config.json', 978, '146a0fb83faa476c7752061d889ad0fb13c1ae2bbcf6e2a83f4319cd47611a48'],
  ['vocab.json', 77_184, '84150f7d9f1b27c571d7000b020479f18b32079f6e98c80555bffdaaede9a37e']
])
const HUBERT_BPE = checkpoint('reazon-research/japanese-hubert-base-k2-rs35kh-bpe', 'a6660b26be72cf66cf18519807ad07866d55eb3e', [
  ['config.json', 1_404, '2059c79df4e8ce8d4b4b8f98ef7672027c59c15a3bcfc6d766537df46e1ec97a'],
  ['model.safetensors', 386_752_584, '1bea14c303e52f441be86c1cfcf41cbb85d1631217fcf02c011455ed906d4b2b'],
  ['preprocessor_config.json', 257, '617bd0950f8cc9ac4062e8c73a7be60305ca5790a243df55fa6f44fb671b55b1'],
  ['special_tokens_map.json', 107, '01cf5274c5e70dad1c5962022fa0ed902b37f95695d626ef58179d472c1cae5d'],
  ['tokenizer_config.json', 89_450, '9e8f5c9c1738ef25d1619e91586d96785149927f0875f4f0fee7a251882c3b55'],
  ['vocab.json', 46_463, 'b88ba8f4e194bd4d1f2791cb899c4d363fa1f8d9f5599168af7040a1dedee506']
])
const ZIPFORMER = checkpoint('reazon-research/japanese-zipformer-base-k2-rs35kh', 'df19e126d86994fb72a0a3653fcb31ebe49e6081', [
  ['config.json', 1_371, '82a33a758a476bceb43895cc1ae6939830cb93fbce87be4744f182341319380b'],
  ['configuration_zipformer.py', 3_560, '4e5dbf47f77ee1bd146fee47a9c0fab93231eec8aac0e11f3363e54c8dccf6a5'],
  ['model.safetensors', 392_886_708, 'd049793ae115e2cd563331dbb8e19cfebbfda348351760fa2efcd8839f9dc67e'],
  ['modeling_zipformer.py', 7_384, '0f5344c83e56861d60bfb8a0a9ff968a63dc43575f4cd3b2e34745152c091abb'],
  ['preprocessor_config.json', 258, '3698647300e38b0a83ccf0ee9b24834e2d262157410305d54a3a1f655ead3002'],
  ['scaling.py', 59_339, '68a9fce0279bcb7aa6c629e27dd9f1592c32837c91885b97c274748422b09116'],
  ['special_tokens_map.json', 107, '01cf5274c5e70dad1c5962022fa0ed902b37f95695d626ef58179d472c1cae5d'],
  ['tokenizer_config.json', 982, 'd5aef0d3647fbc3d568690a4d298fcc7298f7f73c98667d50ab46edab40a2f2b'],
  ['utils.py', 10_207, '7b2dd1c2ad53be649e5c49ae1c26c583644220f4acdc3de6a664641d2e64de29'],
  ['vocab.json', 77_184, '84150f7d9f1b27c571d7000b020479f18b32079f6e98c80555bffdaaede9a37e'],
  ['wav2vec2_module.py', 3_565, '39a53c06b2d4127c291e75182566cdb5b260aac59708eaf26ec2a7de5ee05c9d'],
  ['zipformer.py', 90_971, '29b7ee26611e3b334ab0f65105441110fa2867ba7495b33336a0dd625162f106']
])
const ZIPFORMER_BPE = checkpoint('reazon-research/japanese-zipformer-base-k2-rs35kh-bpe', 'fc70803a1e8b6edfc1093398916c94f1a9682376', [
  ['config.json', 1_371, '5c71f4722db6730432fce5ecd2e21797c6a78466db7343c446728af184de94c2'],
  ['configuration_zipformer.py', 3_560, '4e5dbf47f77ee1bd146fee47a9c0fab93231eec8aac0e11f3363e54c8dccf6a5'],
  ['model.safetensors', 386_039_492, '6bbb85f5cc18607e0137069e04f8b277962d5a07285c943208fca944a6f23c75'],
  ['modeling_zipformer.py', 6_884, '8e76128bba27dbf9444b793090d3976419e73c33024f614773c2033bfaf5396d'],
  ['preprocessor_config.json', 258, '3698647300e38b0a83ccf0ee9b24834e2d262157410305d54a3a1f655ead3002'],
  ['scaling.py', 59_339, '68a9fce0279bcb7aa6c629e27dd9f1592c32837c91885b97c274748422b09116'],
  ['special_tokens_map.json', 107, '01cf5274c5e70dad1c5962022fa0ed902b37f95695d626ef58179d472c1cae5d'],
  ['tokenizer_config.json', 89_454, 'f229f10dd35a9f036c595103768bb026bc5b294decf8c6c03ddb357b9032a712'],
  ['utils.py', 10_207, '7b2dd1c2ad53be649e5c49ae1c26c583644220f4acdc3de6a664641d2e64de29'],
  ['vocab.json', 46_463, 'b88ba8f4e194bd4d1f2791cb899c4d363fa1f8d9f5599168af7040a1dedee506'],
  ['wav2vec2_module.py', 3_565, '39a53c06b2d4127c291e75182566cdb5b260aac59708eaf26ec2a7de5ee05c9d'],
  ['zipformer.py', 90_971, '29b7ee26611e3b334ab0f65105441110fa2867ba7495b33336a0dd625162f106']
])
const WHISPER_LARGE_V3 = checkpoint('openai/whisper-large-v3', '06f233fe06e710322aca913c1bc4249a0d71fce1', [
  ['added_tokens.json', 34_648, '3c51f66c4c21f9e126970078f11ae77a78c74aee8df606ee9daba86e467108e0'],
  ['config.json', 1_272, 'ad0e8d1e46f4d01f7861a21509e5d0f977d6cc1f367a370603c92541d819807b'],
  ['generation_config.json', 3_903, 'fbdfa70135de9b1d31553393f14e80aaeb1936ea36576b2ba864055943c09d23'],
  ['merges.txt', 493_869, '2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6'],
  ['model.safetensors', 3_087_130_976, 'a8e94b85976e5864ba3e9525c7e6c83b2a1eca42d4b797a0c7c24d778e40fd95'],
  ['normalizer.json', 52_666, 'bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd'],
  ['preprocessor_config.json', 340, '7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711'],
  ['special_tokens_map.json', 2_072, '1c70773c078cb2ca96e0fcff113102f1d3e2b1504272c3bb63b035d4a6700d87'],
  ['tokenizer.json', 2_480_617, '6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca'],
  ['tokenizer_config.json', 282_843, '844b642c73a91359722f47b35705f7174686df33d252695d8572cf9ac03a6389'],
  ['vocab.json', 1_036_558, 'e2aa043ef015641d363d8288e7c241c85e36a5c761fb303598e0710233344387']
])
const KOTOBA_WHISPER = checkpoint('kotoba-tech/kotoba-whisper-v2.2', '9d33482a0eb9b57f1ad80708e8ac5538246d8355', [
  ['added_tokens.json', 34_648, '3c51f66c4c21f9e126970078f11ae77a78c74aee8df606ee9daba86e467108e0'],
  ['config.json', 1_499, '75e0166afbf44308af4908793fc5ade1707890ed15760f0529b468dcfc378aec'],
  ['generation_config.json', 3_898, '20d28b9169207ab6ca402ec9342393a88ec3f341d88c9da24e516e1da71c24de'],
  ['merges.txt', 493_869, '2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6'],
  ['model.safetensors', 3_025_686_376, 'e0ef3e7b379515f0c35d0e7885638ddef0fa9f5c8e3e3f88cbc6da9b39edd1e9'],
  ['normalizer.json', 52_666, 'bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd'],
  ['preprocessor_config.json', 340, '7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711'],
  ['special_tokens_map.json', 2_186, 'baea4ea09372eb4fca86b4e4346139fd73cb807d5087e9de0948e971739c3e74'],
  ['tokenizer.json', 3_931_381, '615928f5a25409279b47b47d87a4ca2aaee3bd09f65e1a3df6c9d23c718cfdb0'],
  ['tokenizer_config.json', 282_863, 'c86c7398ba7f81f784569ea0ae165e252c4a006acc56906f04e5ee3300cf043e'],
  ['vocab.json', 835_528, '6788c80b082e9b0d1393147d3a3e62ba19285ac0c82ace8e5ef00f37ead58971']
])
const MOONSHINE_TINY_JA = checkpoint('moonshine-ai/moonshine-tiny-ja', '02ca41b3d9e73db07df9a13f316f2b7497a368e2', [
  ['config.json', 892, '6f50c12148161de95a8bcffa28e08c077ad65f23b9a4d4c0d12b75889ec9be28'],
  ['generation_config.json', 184, 'a0d9715619e5041f4912d70a622ed06480b61e1e116c5bd28fbd2d80943ba593'],
  ['model.safetensors', 108_389_160, '59a3138090fac9903210cf0f5839bbfbba385940d6b33dca4483495e96be79d3'],
  ['preprocessor_config.json', 215, '99272fe8ccfab114b68b478681ea47ee3a1ce62bb788cb92dd6e4f69fb1f1da2'],
  ['tokenizer.json', 3_761_751, 'ad3a2ceb0e84e4da57451d86fa337f8116dcff5f5d106434f8aa0b0de89718b9']
])
const GRANITE_SPEECH = checkpoint('ibm-granite/granite-speech-5.0-2b', 'c684620bb54fc89d14ba27256b23bbc9e09ba764', [
  ['added_tokens.json', 26, 'b4956ad3505e979f2f25cc2e2be2163d8e23730f854b6c5a14ed106f3dd90549'],
  ['chat_template.jinja', 193, 'e3219da52634178f68696475ea4518ade9d1b5c9a71b825f28312b73afc432c0'],
  ['config.json', 2_281, '14e35a6daa1b4bdd38b3fc0b62eaf519e8993a2fbbbc2b527432c684376d62a3'],
  ['generation_config.json', 147, '4a5e80bbcf4116a96b385e0af3ff94b03a7393d424a1201cb1f974e9ffc2e1da'],
  ['merges.txt', 916_646, 'b6fe424e334903f7fb84d3a106d9730455f4744b9fe3c21ee136d97a00e72502'],
  ['model.safetensors', 4_626_528_224, '4151269881d2dd825d45ca75d6552b2a20e6e39d0934ed84c4db826af8bf6d88'],
  ['preprocessor_config.json', 336, '382a6f26300937721969b01909c96c2e519620b6781f7b45cb8b2e348a932d87'],
  ['processor_config.json', 80, '13edc723022827cc3620ba2e2b4bcf52287b365d77e60a31227f0a4b7dea5f9c'],
  ['special_tokens_map.json', 579, 'c08676c49fd7969a3130f72be6d4bf34da66aa484a6e21dffe359893a1bd5f2e'],
  ['tokenizer.json', 7_153_607, '43ca88fd0519c64ef93fa0a90cbc4e560fe485b5ba60348a86bc3c624f37918e'],
  ['tokenizer_config.json', 17_882, 'de233c19cd9efa63738f7481f318fc2048060f751ac9fd7957b131c43226b403'],
  ['vocab.json', 1_612_704, '8af71076de8b0b626eed0f4c984faf0a7c062479164b2a31308a948524d4f69c']
])
const COHERE_TRANSCRIBE = checkpoint('CohereLabs/cohere-transcribe-03-2026', 'd552dadc2922ba6f6c1f994f8db904d52dcaf942', [
  ['config.json', 3_998, '5de7e586cec6d8f51225c8d5fe17a56a3043dda9af8c42f9cb01dd545905eb18'],
  ['generation_config.json', 234, 'a4837377b5696b1d04033536f25a6d0a11d5e613c6d7d75bf20ffc463ae642c6'],
  ['model.safetensors', 4_131_862_976, '987bd3e141c7bfdb5a78f5db11397ee7737308357e6cc0a3f36a4979b158137a'],
  ['preprocessor_config.json', 420, '9f297d330646ecc8ebb9dc5784f48b7c35b118c913e306a1ccd0192f2c976332'],
  ['processor_config.json', 131, 'd5eff85971bab7f42480856f8fb397d8dd966858d67049def99aa8a665aa87d5'],
  ['special_tokens_map.json', 4_091, '1814ce01458ff6a72b04a6618e75f18ce627be4dc17619cd3a7cd7f71e137f0f'],
  ['tokenizer.json', 1_816_694, '780ccca2de2ccd289971b1fb7d4f0b5ec2dc908872f6e350181c7eba9db3fa9f'],
  ['tokenizer.model', 492_827, '6d21e6a83b2d0d3e1241a7817e4bef8eb63bcb7cfe4a2675af9a35ff3bbf0e14'],
  ['tokenizer_config.json', 48_138, 'b462e16e04c9dbae82289b6ef9b080d8dbad331586ece3ebded0bd09996db636']
])
const VOXTRAL_REALTIME = checkpoint('mistralai/Voxtral-Mini-4B-Realtime-2602', '2769294da9567371363522aac9bbcfdd19447add', [
  ['config.json', 1_572, '96582f5809ad179531d47f9f89d76c696058fbdeff608d6611dcb7e076ea7e93'],
  ['generation_config.json', 191, '1fabdbadf2e0ea9e2c36e2a8460a53caa694c1324136e4158032b0a32ff6beec'],
  ['model.safetensors', 8_859_446_848, 'e745e4902df6a4c48f29f2f8dc1f6d0fb4cc73c7156bc45923451a5bcdfcd1d6'],
  ['params.json', 1_343, '2ace010ebf7f0b62c60747d91c6d140e3c7238632d3e9c63d60a2bd2065ea301'],
  ['processor_config.json', 384, '5fbc4247e0b3b72c1b501b872c4fd6432b1f0fcc1939dcdf1fa5142c6d2ce070'],
  ['tekken.json', 14_910_348, '8434af1d39eba99f0ef46cf1450bf1a63fa941a26933a1ef5dbbf4adf0d00e44']
])
const REAZONSPEECH_K2 = checkpoint('reazon-research/reazonspeech-k2-v2', '291488c8151be24d7da4bf7af26e533fad96e407', [
  ['decoder-epoch-99-avg-1.onnx', 11_767_836, '58b18211ae06265466bfa17172dab574df94f76c8bcb61a3640c28ba860e4124'],
  ['encoder-epoch-99-avg-1.onnx', 592_347_848, 'ecdb0b771e16104aaf8e579cb3c1e32fbd589eb641c5946d82b615bd366c5f96'],
  ['joiner-epoch-99-avg-1.onnx', 10_720_115, 'd38a81d1191c9ed6de6a1719503692e07e3e973e2364adde0abae5eaaded1174'],
  ['tokens.txt', 45_754, '2c3ac659818a48a0c04010e0593bbc4d7c8a24a054340b01131499c05fd52def']
])
const PARAKEET_JA = checkpoint('nvidia/parakeet-tdt_ctc-0.6b-ja', '44edb27eea9317daf89333e75eb830db4b1cc298', [
  ['parakeet-tdt_ctc-0.6b-ja.nemo', 2_490_951_680, 'a2ed2aab9c82cce4e9b699dca669184d7525c7b5e1eb8c3f7b789421bc3637e8']
])
const REAZONSPEECH_NEMO = checkpoint('reazon-research/reazonspeech-nemo-v2', '33693408be76b7cba9fd4a7546a0a8772430211b', [
  ['reazonspeech-nemo-v2.nemo', 2_477_946_880, 'd196d43ad03466ca88beeda4bf5fafb07bab7202d4b663b8e4f12cb0a4381fae']
])
const VIBEVOICE_ASR_STREAMING = checkpoint('microsoft/VibeVoice-ASR-Streaming-7B', '60d858b518b4e19d404af3737f848fc185b30177', [
  ['added_tokens.json', 713, 'd0a4c6e0954c94843fae3c966a7d0b52c7b8c0787fba5731733e6ab602245b88'],
  ['config.json', 3_709, '804c6e78705f629e0e3484ce130967d43f8d5e1a728e5c1322bdd697e8704c7d'],
  ['merges.txt', 1_671_839, '599bab54075088774b1733fde865d5bd747cbcc7a547c5bc12610e874e26f5e3'],
  ['model-00001-of-00008.safetensors', 2_488_346_304, '3685d210ad49c49521e71a0cc5418ea94b20761c801dc8fc95938c4ec1ab27b3'],
  ['model-00002-of-00008.safetensors', 2_389_316_008, 'd0252f5e9bdf7e65bb0ae051c49148fd5d77e531057556eb955fc6dc72f4f0bc'],
  ['model-00003-of-00008.safetensors', 2_466_376_400, 'eeeb0c24e4a3746f16512c0d4aef84732bf8bb4dc5452782e4db356eb5fc7ce7'],
  ['model-00004-of-00008.safetensors', 2_466_376_432, '02fec24aaf3e59cbc653b55d94665d6393543f2550364c2c8bc9e75e2a2ca3c0'],
  ['model-00005-of-00008.safetensors', 2_499_431_160, 'a78637bdc2b44f28601f7ee12503e28f5e9faedde35ff5bcdc2e7356c9a6458e'],
  ['model-00006-of-00008.safetensors', 2_483_469_960, '5bc9dfef14c62989192ab39356da45a9ccc9f0ef82f7f7127e48c17b5bd5a2f8'],
  ['model-00007-of-00008.safetensors', 1_464_887_514, 'bb6da42b3547124eb67645fc6fb92523e93310a107872643f7df6dd75f85b4d7'],
  ['model-00008-of-00008.safetensors', 1_089_994_880, 'b1499fbe8bc0454eeafc1177db144679940f2456eae188299214c629d4d618b4'],
  ['model.safetensors.index.json', 120_115, '29df2f8e046f5bd8a6d765a700fd767a9c505fa46fe9fd6d50f476c3bdcae638'],
  ['preprocessor_config.json', 192, '99bf76b83a21385d2a8f5226edd9ec598f63e1ff7a50384dc8cf6b7753b9f9c4'],
  ['special_tokens_map.json', 1_177, 'cf263f1a86f252cae2cef55ca02f001fecefc92646016f0ed2f7349238b8504d'],
  ['tokenizer.json', 7_032_406, '38e847ed54238171badeeaeaf8760632c949336d3d54207d2d34483c56bc7d57'],
  ['tokenizer_config.json', 9_330, 'badef858f0481ccaea85cf86879737f1397c61d0385cdc9b785b657407606e02'],
  ['vocab.json', 2_776_833, 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910']
])

/** The languages of Whisper large-v3's model card, with Javanese under its BCP 47 tag, where the card writes `jw`. */
const WHISPER_LANGUAGES = ['en', 'zh', 'de', 'es', 'ru', 'ko', 'fr', 'ja', 'pt', 'tr', 'pl', 'ca', 'nl', 'ar', 'sv', 'it', 'id', 'hi', 'fi', 'vi', 'he', 'uk', 'el', 'ms', 'cs', 'ro', 'da', 'hu', 'ta', 'no', 'th', 'ur', 'hr', 'bg', 'lt', 'la', 'mi', 'ml', 'cy', 'sk', 'te', 'fa', 'lv', 'bn', 'sr', 'az', 'sl', 'kn', 'et', 'mk', 'br', 'eu', 'is', 'hy', 'ne', 'mn', 'bs', 'kk', 'sq', 'sw', 'gl', 'mr', 'pa', 'si', 'km', 'sn', 'yo', 'so', 'af', 'oc', 'ka', 'be', 'tg', 'sd', 'gu', 'am', 'yi', 'lo', 'uz', 'fo', 'ht', 'ps', 'tk', 'nn', 'mt', 'sa', 'lb', 'my', 'bo', 'tl', 'mg', 'as', 'tt', 'haw', 'ln', 'ha', 'ba', 'jv', 'su']

/**
 * The instruction of Granite Speech 5.0's card that names the language, `<language>` standing for its English name. The
 * card's other instruction for transcription asks for punctuation and capitalization without the language.
 */
export const GRANITE_SPEECH_INSTRUCTION = 'The speech is in <language>. Transcribe it exactly; do not translate. can you transcribe the speech into a written format?'

const reazonSpeechCtc = (id: string, label: string, files: PinnedFile[]): AsrModel =>
  ({ id: `${id}-official`, label: `${label}, official BF16`, runtime: 'adapter', adapter: 'transformers-4-asr', recipe: 'reazonspeech-ctc', precision: 'bf16', instruction: null, files, languages: ['ja'], languageHint: 'none', license: 'Apache-2.0' })

/**
 * ReazonSpeech's CTC models, Whisper large-v3, Kotoba-Whisper v2.2, Moonshine Tiny Japanese, Granite Speech 5.0,
 * Cohere Transcribe and Voxtral Realtime in transformers, ReazonSpeech's k2 model in its package, ReazonSpeech NeMo v2
 * and parakeet-tdt_ctc-0.6b-ja in NeMo, and VibeVoice-ASR-Streaming in VibeVoice, each in the precision its card runs it
 * in on CUDA.
 */
export const OFFICIAL_ASR_MODELS: readonly AsrModel[] = [
  reazonSpeechCtc('japanese-wav2vec2-base-rs35kh', 'japanese-wav2vec2-base-rs35kh', WAV2VEC2_BASE),
  reazonSpeechCtc('japanese-wav2vec2-large-rs35kh', 'japanese-wav2vec2-large-rs35kh', WAV2VEC2_LARGE),
  reazonSpeechCtc('japanese-hubert-base-k2-rs35kh', 'japanese-hubert-base-k2-rs35kh', HUBERT),
  reazonSpeechCtc('japanese-hubert-base-k2-rs35kh-bpe', 'japanese-hubert-base-k2-rs35kh-bpe', HUBERT_BPE),
  reazonSpeechCtc('japanese-zipformer-base-k2-rs35kh', 'japanese-zipformer-base-k2-rs35kh', ZIPFORMER),
  reazonSpeechCtc('japanese-zipformer-base-k2-rs35kh-bpe', 'japanese-zipformer-base-k2-rs35kh-bpe', ZIPFORMER_BPE),
  { id: 'whisper-large-v3-official', label: 'Whisper large-v3, official FP16', runtime: 'adapter', adapter: 'transformers-asr', recipe: 'whisper', precision: 'fp16', instruction: null, files: WHISPER_LARGE_V3, languages: WHISPER_LANGUAGES, languageHint: 'optional', license: 'Apache-2.0' },
  // The card's pipeline adds speaker diarization and punctuation around the model, neither of which changes the
  // words: the scoring folds the punctuation that is not read, and an utterance has one speaker.
  { id: 'kotoba-whisper-v2.2-official', label: 'Kotoba-Whisper v2.2, official FP16', runtime: 'adapter', adapter: 'transformers-asr', recipe: 'whisper', precision: 'fp16', instruction: null, files: KOTOBA_WHISPER, languages: ['ja'], languageHint: 'optional', license: 'Apache-2.0' },
  { id: 'moonshine-tiny-ja-official', label: 'Moonshine Tiny Japanese, official FP16', runtime: 'adapter', adapter: 'transformers-asr', recipe: 'moonshine', precision: 'fp16', instruction: null, files: MOONSHINE_TINY_JA, languages: ['ja'], languageHint: 'none', license: 'Moonshine AI Community License' },
  { id: 'granite-speech-5.0-2b-official', label: 'Granite Speech 5.0 2B, official BF16', runtime: 'adapter', adapter: 'transformers-asr', recipe: 'granite-speech', precision: 'bf16', instruction: GRANITE_SPEECH_INSTRUCTION, files: GRANITE_SPEECH, languages: ['en', 'fr', 'de', 'es', 'pt', 'ja'], languageHint: 'optional', license: 'Apache-2.0' },
  { id: 'cohere-transcribe-03-2026-official', label: 'Cohere Transcribe 03-2026, official BF16', runtime: 'adapter', adapter: 'transformers-asr', recipe: 'cohere-asr', precision: 'bf16', instruction: null, files: COHERE_TRANSCRIBE, languages: ['ar', 'de', 'el', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'pl', 'pt', 'vi', 'zh'], languageHint: 'optional', license: 'Apache-2.0' },
  { id: 'voxtral-mini-4b-realtime-2602-official', label: 'Voxtral Mini 4B Realtime 2602, official BF16', runtime: 'adapter', adapter: 'transformers-asr', recipe: 'voxtral-realtime', precision: 'bf16', instruction: null, files: VOXTRAL_REALTIME, languages: ['en', 'fr', 'es', 'de', 'ru', 'zh', 'ja', 'it', 'pt', 'nl', 'ar', 'hi', 'ko'], languageHint: 'none', license: 'Apache-2.0' },
  { id: 'reazonspeech-k2-v2-official', label: 'ReazonSpeech k2 v2, official FP32 on the CPU', runtime: 'adapter', adapter: 'reazonspeech-k2', files: REAZONSPEECH_K2, languages: ['ja'], languageHint: 'none', license: 'Apache-2.0' },
  { id: 'reazonspeech-nemo-v2-official', label: 'ReazonSpeech NeMo v2, official FP32', runtime: 'adapter', adapter: 'nemo-asr', family: 'reazonspeech', files: REAZONSPEECH_NEMO, languages: ['ja'], languageHint: 'none', license: 'Apache-2.0' },
  { id: 'parakeet-tdt_ctc-0.6b-ja-official', label: 'parakeet-tdt_ctc-0.6b-ja, official FP32', runtime: 'adapter', adapter: 'nemo-asr', family: 'parakeet', files: PARAKEET_JA, languages: ['ja'], languageHint: 'none', license: 'CC-BY-4.0' },
  { id: 'vibevoice-asr-streaming-7b-official', label: 'VibeVoice-ASR-Streaming 7B, official BF16', runtime: 'adapter', adapter: 'vibevoice-asr', seed: 0, files: VIBEVOICE_ASR_STREAMING, languages: ['en', 'zh', 'es', 'pt', 'de', 'ja', 'ko', 'fr', 'ru', 'it'], languageHint: 'none', license: 'MIT' }
]
