# Pesquisa para as 5 páginas novas (Proficiência, Maestria, Eventos, Comandos, Servidores)

## Comandos de console (gm <Comando> args)
- `cheat.json`: 259 comandos de UHCheatManager (nome, parâmetros [nome, tipo 3=int 10=float 21=str 44=bool], ToolTip em chinês). Gerado por `cheat_funcs.py` lendo a DLL `Projects/WS/Binaries/Win64/UE4Editor-WS.dll`.
- `all.json`: todas as UFunctions; os comandos de servidor/RCON ficam em `Online/ServerSupervise.h` (filtro flags 0x20601), ex.: SaveWorld, List_OnlinePlayers, CreateItemForPlayer, SaveAndExit, Set_Coefficient.
- Admin em servidor: `gm Key <senha>` (senha definida com `-adminpsw=`). Não existe comando "AddItem": itens/criaturas são criados pelo painel GM (WBP_ZuoBiUI), por `CreateSWByClass` ou pelo RCON `CreateItemForPlayer`.
- A fazer: lista curada PT/EN com sinônimos para busca ("invocar lacaio" -> Recruit/ZhaoMu/CreateSWByClass, "remover talento" -> RemoveNG/ClearNG).

## Proficiência
- `DT_ProficiencyConfig_*` (150 níveis): `ProfConsumeExp` por nível (soma: 3110 no nv 30, 62844 no 100, 100296 no 120, 178086 no 150).
- Bônus contínuo = soma de `ProfBenefitConfigList` até o nível (ex.: Lâmina, dano +0,5%/nível). Bônus de marco em 30/60/90/120 vêm de `UnlockProfBenefitConfigList` (+5/6/7/8%, com DescText e ícone Pic).
- Qualidade de fabricação: `TeShuProfBenefitVal` (lista por tier de material).
- Nomes: `enums.json` (EProficiencyBenefit -> índice) + WBP_ShuLianDu `BenefitTextMap(índice)` no .po. Proficiências: EProficiency -> DT_YiWenText `Proficiency_N`, e "como ganhar EXP" vem de `GainExpDescMap(N)`.
- Bônus de classe: `DT_Prof_ZhiYe_*` (MinAdd 15, MaxAdd 25 no limite).

## Maestria: DT_SpecializedSkill (88) -> CDO do GA (AbilityName, JinengMiaoshu, AbilityIcon, CooldownGameplayEffectClass); DT_ZhuanJingSLD (chance em 30/60/90/120); DT_GuDingZhuanJing.
## Eventos: BP_ZiYuanGuanLiQi.ZhanChangTimeConfigMap (arena por região), PVPHoursMap; textos de invasão em DT_XiShuTipsText (RuQinBeginHour/RuQinEndHour).
## Servidores: Firestore `servers` + regras + handler Netlify de destaque pago (pedir aprovação antes de publicar).
