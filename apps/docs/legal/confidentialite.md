---
description: Comment Ajour traite les données locales, les identifiants, les requêtes réseau et les demandes de confidentialité.
sidebar: false
editLink: false
lastUpdated: false
prev: false
next: false
---

<div lang="fr">

# Politique de confidentialité

Dernière mise à jour : 24 octobre 2026

<a href="/legal/privacy" lang="en">English version</a> · [Conditions d'utilisation](/legal/conditions)

## Qui est responsable

Ajour est publié par Alex Trépanier, qui exerce ses activités sous le nom cabochons.io. Dans cette politique, "nous" désigne Alex Trépanier. Alex Trépanier est aussi le responsable de la protection des renseignements personnels. Vous pouvez lui écrire à [info@cabochons.io](mailto:info@cabochons.io) pour toute question, demande ou plainte concernant vos renseignements personnels.

Cette politique couvre l'application Ajour, les plugins que nous maintenons, son site de documentation et les renseignements que vous nous transmettez. Ajour est un outil de suivi du temps qui conserve d'abord les données sur votre appareil. Aucun compte Ajour n'est nécessaire. Nous n'exploitons pas de service qui reçoit votre espace de travail pour le conserver ou le sauvegarder. L'application ne nous envoie pas de télémétrie d'utilisation ni de rapports de plantage automatiques.

## L'application Ajour

Cette section couvre le stockage, les identifiants, les requêtes réseau et l'accès des agents dans l'application. Les sections suivantes décrivent les données utilisées par chacun des plugins que nous maintenons. Les plugins et les agents facultatifs peuvent transmettre des données aux services que vous choisissez.

### Votre espace de travail local

Ajour conserve sur votre appareil les projets, les tâches, les entrées de temps, les notes, les éléments du backlog, le contenu importé, les paramètres et les connexions des plugins. Les renseignements lus dans un service connecté peuvent comprendre des descriptions, des commentaires ainsi que le nom ou les coordonnées de personnes. Ajour récupère les événements de calendrier pour les afficher, sans constituer d'archive du calendrier. Un événement que vous ajoutez comme entrée de temps fait alors partie de votre espace de travail.

Ces données servent aux fonctions que vous utilisez. Le fonctionnement local habituel ne nous les transmet pas. Nous ne vendons pas de renseignements personnels, ne les utilisons pas à des fins publicitaires et ne créons pas de profils de votre activité pour nos propres fins.

Le guide [Your data](/app/data), en anglais, précise où se trouvent les données et comment les sauvegarder ou les supprimer. Votre système d'exploitation, vos outils de sauvegarde ou l'administrateur de votre appareil peuvent aussi avoir accès aux fichiers locaux.

L'import et l'export de projets et d'entrées de temps lisent ou écrivent des fichiers sur votre appareil. Un plugin de schéma qui ne fait que convertir des données locales en colonnes de fichier, comme le schéma Workday, n'ajoute pas de transmission externe distincte. Vous choisissez où enregistrer ou envoyer le fichier exporté.

### Identifiants et accès des plugins

Les jetons de connexion et les autres champs secrets, des connexions comme des paramètres des tâches d'agent, sont conservés dans le fichier local `app-api-vault.json`, chiffrés avec une clé que votre système d'exploitation garde pour votre compte utilisateur. Le fichier `app-api-state.json` indique seulement quels champs secrets sont renseignés. Ajour refuse d'enregistrer un secret quand l'ordinateur ne peut pas le chiffrer et ne le conserve jamais en clair à la place. Il masque aussi les champs secrets dans les paramètres et retire les secrets de connexion connus des erreurs et des résumés des plugins. Ces mesures réduisent les divulgations accidentelles, par exemple par une copie du dossier de données. Elles n'isolent pas les identifiants du code des plugins installés ni des autres programmes qui s'exécutent sous votre compte utilisateur.

Ajour déchiffre actuellement les identifiants d'une connexion pour les transmettre au plugin de cette connexion. Le code du plugin s'exécute avec les permissions de votre compte utilisateur, peut lire les fichiers locaux et peut faire des requêtes réseau. Il ne s'exécute pas dans un bac à sable. Installez des plugins auxquels vous faites confiance, donnez à chaque jeton le moins de permissions possible et protégez le dossier de données ainsi que ses sauvegardes.

Nous sommes responsables de la manière dont Ajour traite les identifiants. Le courtier d'identifiants prévu gardera les secrets hors du code des plugins et fera les requêtes authentifiées autorisées pour les plugins. Des bacs à sable distincts sont aussi prévus. Ces protections ne sont pas encore disponibles et ne constituent pas des garanties sur la version actuelle. Même avec un courtier, un plugin pourrait faire un mauvais usage des données ou des actions auxquelles vous lui donnez accès.

### Requêtes réseau et services connectés

L'application de bureau fait les requêtes suivantes pour les mises à jour et la découverte des plugins, indépendamment des services que vous connectez :

| Fonction                                | Renseignements et destinataire                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mises à jour de l'application           | L'application de bureau contacte GitHub au démarrage, environ toutes les quatre heures pendant qu'elle est ouverte et à votre demande. Les requêtes portent sur les versions publiées, y compris le canal de mise à jour et la version installée lorsque nécessaire. Le téléchargement attend votre confirmation. |
| Catalogue et téléchargement des plugins | Ajour contacte GitHub pour le catalogue, ses images et les versions publiées. Par défaut, le catalogue s'actualise au lancement et toutes les 15 minutes. Le téléchargement d'un plugin contacte GitHub et ses hôtes de téléchargement.                                                                           |

GitHub et ses hôtes de téléchargement reçoivent les renseignements ordinaires d'une connexion, dont votre adresse IP et les métadonnées de la requête. Les requêtes de mise à jour et de catalogue ne contiennent pas vos entrées de temps ni vos jetons de connexion. GitHub explique ses pratiques dans sa [déclaration de confidentialité](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

Les requêtes propres aux services des plugins sont décrites plus bas. Suivre un lien externe ou envoyer un fichier exporté peut aussi communiquer des renseignements à la destination choisie.

### Sessions du navigateur des agents

MCP et l'exécution de tâches d'agent sont facultatifs. Un agent peut transmettre à son fournisseur les renseignements qu'il lit, dont les entrées de temps, les notes, le contenu des éléments de travail et les pages visitées. L'utilisation de ces fonctions d'Ajour ne nous transmet pas ces renseignements.

En mode navigateur séparé, Ajour conserve un profil local entre les tâches. Ce profil peut garder des témoins, aussi appelés cookies, et des sessions ouvertes, dont une session Workday. Si vous reliez un agent à votre propre navigateur, celui-ci conserve ses propres données de session. Terminer une tâche ne ferme pas les sessions. Le guide [Your data](/app/data#back-up-export-or-delete-data), en anglais, explique comment les effacer localement.

## Les plugins que nous maintenons

Ces informations concernent les plugins que nous maintenons et qui accèdent à des données ou en transmettent. Le stockage local et le traitement des identifiants décrits plus haut s'appliquent aussi à ces plugins. Pour un plugin maintenu par un autre auteur, consultez les informations de confidentialité de cet auteur.

Le service connecté reçoit les identifiants et les données nécessaires à l'opération, ainsi que les renseignements ordinaires d'une connexion, comme votre adresse IP. Nous n'en recevons pas de copie par un relais exploité par Ajour. Les données synchronisées dans votre espace de travail suivent les règles de stockage et de suppression locales d'Ajour. Les données envoyées à un outil source, à un serveur d'équipe ou à un fournisseur d'IA peuvent y rester après le retrait de la connexion dans Ajour. Les conditions et les règles de conservation et de suppression de leur exploitant s'appliquent à ces copies.

### Google {#donnees-du-compte-et-du-calendrier-google}

La connexion Google et le plugin Google Calendar sont en développement et ne font pas partie de la version publique actuelle. Cette section décrit le traitement prévu de leurs données. Elle ne décrit pas la sécurité des plugins à jetons actuels. Si la mise en oeuvre change ces pratiques, nous mettrons cette politique à jour avant de rendre l'intégration disponible.

#### Accès aux données et utilisation

La connexion à Google sera facultative. Ajour demandera `openid` et `email` pour identifier le compte Google que vous choisissez. L'accès au calendrier sera demandé séparément lorsque vous activerez les suggestions, avec la permission `https://www.googleapis.com/auth/calendar.events.owned.readonly`. Cette permission permet de lire les événements des calendriers Google dont vous êtes propriétaire. Elle ne permet pas à Ajour de créer, de modifier ou de supprimer des événements Google. Ajour ne demandera pas de permissions Gmail, Google Drive ou Google Contacts pour cette intégration.

| Données Google                                                                                                                                                                                                                                                              | Pourquoi Ajour y accède                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L'identifiant stable de votre compte Google et votre adresse courriel, y compris son état de vérification                                                                                                                                                                   | Pour distinguer vos comptes connectés et montrer celui qu'utilise une connexion. Ajour n'utilisera pas votre adresse à des fins de marketing.                                                |
| Les jetons d'accès OAuth, les jetons de renouvellement, les permissions accordées et les renseignements d'expiration                                                                                                                                                        | Pour authentifier les requêtes que vous autorisez et maintenir la connexion sans vous demander de vous reconnecter à chaque requête. Ces identifiants ne sont pas votre mot de passe Google. |
| Les identifiants d'événements et de séries récurrentes, les titres, les heures de début et de fin, les fuseaux horaires, le caractère journée entière, l'état d'annulation, l'état occupé ou libre, votre réponse à l'invitation et le fait que vous organisiez l'événement | Pour afficher les suggestions des dates consultées, appliquer vos filtres, reconnaître les réunions récurrentes et éviter de suggérer une occurrence déjà ajoutée ou ignorée.                |

La permission de calendrier peut donner accès à plus de détails qu'Ajour n'en a besoin. L'intégration limitera ses requêtes aux champs nécessaires aux usages ci-dessus. Les descriptions d'événements, les lieux, les liens de conférence et les coordonnées des autres participants ne font pas partie des données des suggestions de calendrier d'Ajour.

Lire un événement ne créera pas d'entrée de temps et ne modifiera pas Google Calendar. Lorsque vous choisissez d'ajouter une suggestion, son titre et sa durée peuvent faire partie d'une entrée de temps locale. Mémoriser ou masquer une réunion récurrente conserve localement son identifiant, son titre et le projet et la tâche choisis, ou le choix de la masquer.

#### Communication des données et accès humain

Les requêtes aux services de connexion et de calendrier Google partiront de votre appareil vers Google. Google reçoit les identifiants et les renseignements nécessaires pour y répondre. Nous ne recevrons pas vos identifiants Google ni une copie de votre calendrier par un serveur exploité par Ajour. Le plugin de calendrier autorisé recevra les champs nécessaires aux suggestions par le courtier d'identifiants d'Ajour, sans recevoir les jetons du compte.

Les outils MCP d'Ajour ne donnent pas accès aux listes d'événements récupérées. Lorsque vous transformez un événement en entrée de temps ou en réunion mémorisée, ses données enregistrées font partie de votre espace de travail. Si vous autorisez un agent à lire cet espace, exportez les données ou les transmettez à un service de feuilles de temps, le contenu dérivé de Google peut parvenir au fournisseur d'IA ou à la destination que vous choisissez. Ces transferts doivent servir la fonction demandée et respecter les exigences d'utilisation limitée de Google. L'accès général d'un agent n'est pas une exception à ces exigences.

Nous ne vendrons pas les données Google, ne les communiquerons pas à des annonceurs ou à des courtiers en données et ne les utiliserons pas pour évaluer la solvabilité. Nous n'utiliserons pas les données des API Google Workspace pour développer, améliorer ou entraîner des modèles d'IA ou d'apprentissage automatique non personnalisés, et ne les transférerons pas à ces fins. Ces restrictions couvrent aussi les données dérivées de Google, comme le titre d'un événement enregistré dans une entrée de temps.

Nous n'avons pas d'accès humain habituel à votre calendrier Google, puisqu'il reste sur votre appareil. Si vous choisissez d'inclure des données Google précises dans une demande d'assistance, nous les utiliserons pour traiter cette demande selon les conditions de contact et de conservation ci-dessous. Tout autre accès ou toute autre communication doit reposer sur le consentement ou une autre base permise par la politique de Google et la loi applicable.

#### Protection des données

L'intégration Google prévue utilisera HTTPS pour les requêtes à Google et une connexion par code d'autorisation avec PKCE. Les jetons d'accès resteront en mémoire. Les jetons de renouvellement seront conservés localement avec le chiffrement du système d'exploitation. Ajour refusera de les conserver si ce chiffrement n'est pas disponible. Le courtier fera les requêtes authentifiées et gardera les jetons hors du code des plugins. Ce sont des protections prévues, pas des mesures présentes dans l'exécution des plugins de la version publique actuelle.

Les entrées de temps et les réunions mémorisées utilisent le stockage ordinaire de l'espace de travail. Ajour ne chiffre pas l'ensemble de cet espace. Protégez votre compte sur l'appareil, utilisez le chiffrement de disque du système d'exploitation lorsqu'il est disponible et protégez vos sauvegardes et vos exports. Le chiffrement des identifiants par le système d'exploitation ne protège pas contre une personne qui contrôle déjà votre appareil ou votre compte utilisateur.

#### Conservation

Nous ne conserverons pas de copie des données de compte ou de calendrier Google sur un serveur. Les règles suivantes s'appliqueront sur votre appareil :

| Données                                                               | Durée de conservation                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jetons d'accès                                                        | En mémoire pendant la session de l'application, remplacés au besoin et effacés par une déconnexion ou la fermeture de l'application.                                                                                                                                                                                                                                        |
| Jetons de renouvellement                                              | Dans le stockage local chiffré jusqu'à votre déconnexion, au retrait du compte ou au remplacement de ses identifiants. La déconnexion efface les jetons de cet appareil, sans retirer l'autorisation Google sur les autres appareils.                                                                                                                                       |
| Identifiant du compte, adresse courriel et autorisations enregistrées | Jusqu'au retrait du compte. Une déconnexion peut conserver la fiche du compte pour vous permettre de vous reconnecter.                                                                                                                                                                                                                                                      |
| Événements de calendrier récupérés                                    | En mémoire pour les suggestions, sans archive enregistrée du calendrier. Recharger ou fermer Ajour efface ce cache. Un échec d'actualisation peut conserver les résultats précédents en mémoire.                                                                                                                                                                            |
| Décisions d'ajouter ou d'ignorer une occurrence                       | Localement jusqu'au retrait de la connexion, ou jusqu'à ce qu'un chargement ultérieur de l'espace de travail retire les décisions concernant des événements de plus de 90 jours.                                                                                                                                                                                            |
| Réunions récurrentes mémorisées ou masquées                           | Localement jusqu'au retrait de la réunion mémorisée ou de sa connexion de calendrier. Ces données comprennent l'identifiant et le titre de la réunion.                                                                                                                                                                                                                      |
| Entrées de temps créées à partir d'événements                         | Dans votre espace de travail jusqu'à leur suppression. Si une entrée a déjà été transférée à une feuille de temps externe, Ajour garde ses dernières valeurs transférées comme suppression en attente jusqu'à ce que vous confirmiez le transfert de cette suppression. Retirer le compte ou la connexion Google ne supprime pas les entrées que vous avez choisi de créer. |

Vos sauvegardes et vos exports peuvent conserver des copies après la suppression dans Ajour. Leur conservation dépend de vous. Google et les destinations auxquelles vous envoyez volontairement des données contrôlent leurs copies selon leurs politiques.

#### Déconnexion et suppression des données Google

Lorsque cette intégration sera disponible, une déconnexion dans Ajour supprimera les jetons locaux du compte et arrêtera l'accès authentifié par ce compte. Retirer le compte supprimera aussi son identité et ses autorisations enregistrées. Retirer une connexion de calendrier supprimera ses réunions mémorisées et ses décisions par occurrence. Pour supprimer les entrées de temps créées à partir d'événements, supprimez-les séparément et confirmez le transfert de toute suppression en attente d'une entrée déjà envoyée à votre feuille de temps. Pour effacer les événements récupérés en mémoire, rechargez ou fermez Ajour.

Vous pouvez révoquer la permission d'Ajour dans les [connexions tierces de votre compte Google](https://myaccount.google.com/connections). La révocation chez Google est distincte de la suppression locale. Elle retire l'autorisation du projet sur tous les appareils. Les autres appareils peuvent toutefois conserver des données locales déjà récupérées ou enregistrées. Déconnecter Ajour ne supprime pas vos événements originaux dans Google Calendar.

Pour tout supprimer localement, suivez le guide [Your data](/app/data#back-up-export-or-delete-data), en anglais, et supprimez aussi vos sauvegardes et vos exports. Pour poser une question ou demander la suppression de données Google que vous nous avez volontairement envoyées dans une demande d'assistance, écrivez à [info@cabochons.io](mailto:info@cabochons.io). Nous ne pouvons pas supprimer à distance un espace de travail que nous ne détenons pas.

#### Exigences d'utilisation limitée de Google

L'utilisation et le transfert par Ajour des renseignements reçus des API Google respecteront la [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), y compris ses exigences d'utilisation limitée, appelées Limited Use. Cela s'applique aux données Google et aux données dérivées décrites ci-dessus. Une future fonction qui exige des données supplémentaires ou une nouvelle communication nécessitera une mise à jour des informations et le consentement requis avant cet accès ou cette communication.

### Microsoft {#connexion-microsoft-prevue}

La connexion Microsoft par le courtier d'identifiants est aussi en développement et n'est pas disponible dans la version actuelle.

Si vous vous connectez à un compte Microsoft avec cette fonction, Ajour gardera les identifiants du compte chiffrés sur votre appareil, sans nous les envoyer ni les transmettre au code des plugins. Il demandera le minimum de permissions pour les fonctions que vous choisissez. Les renseignements d'identité serviront seulement à distinguer les comptes lorsque nécessaire. L'accès au calendrier sera demandé à son activation. Les plugins autorisés utiliseront le compte par l'intermédiaire du courtier.

La version qui ajoutera la connexion Microsoft mettra cette politique à jour et expliquera les permissions, le retrait d'un compte et la révocation auprès du fournisseur. Supprimer un identifiant local et révoquer une permission chez un fournisseur sont deux actions différentes.

### Azure DevOps

Le [plugin Azure DevOps](/plugins/azure-devops), dont le guide est en anglais, utilise l'adresse de votre organisation et votre jeton d'accès personnel pour lire ses éléments de travail et ses demandes de fusion. Ces données peuvent comprendre les noms des projets et des dépôts, les titres et les descriptions des éléments, les estimations, les états, les priorités, les commentaires, l'activité de revue et l'identité des personnes concernées. Les identités peuvent inclure les noms, les adresses courriel et les avatars retournés par Azure DevOps. Les suggestions de personnes peuvent rechercher dans l'organisation lorsque votre jeton le permet.

Le plugin envoie à Azure DevOps les changements de description, d'estimation, d'état, de priorité, de commentaire, de réaction et de mention que vous demandez. Les éléments importés sont enregistrés dans votre espace de travail local. Le texte des commentaires est récupéré pour l'affichage et gardé en mémoire, sans archive enregistrée des commentaires. Le contenu des commentaires et des revues de demandes de fusion peut servir à établir les faits d'activité et de mention. Leur texte ne fait pas partie de ces faits synchronisés. Retirer une connexion n'efface pas le contenu déjà envoyé à Azure DevOps.

### GitHub

Le [plugin GitHub](/plugins/github), dont le guide est en anglais, utilise l'adresse de GitHub ou de votre serveur GitHub Enterprise et votre jeton d'accès personnel. Il lit l'identité de votre compte, les appartenances aux organisations et aux équipes nécessaires aux demandes de revue, les noms des dépôts, les issues qui vous sont assignées et leurs descriptions, ainsi que les faits des demandes de fusion, comme les auteurs, les personnes chargées de la revue, les vérifications et l'activité. Il peut lire le texte des commentaires et des revues pour repérer les mentions et l'activité de revue.

Ajour conserve localement les issues importées et les faits des demandes de fusion. Le texte des commentaires et des revues ne fait pas partie de ces faits enregistrés. Lorsque vous demandez de changer l'état d'une issue, le plugin transmet ce changement à GitHub. Dans cette version, les commentaires, les revues et les fusions de demandes se font sur GitHub lui-même. Retirer la connexion ne supprime pas les issues ou les demandes de fusion originales dans GitHub.

### Jira

Le [plugin Jira](/plugins/jira), dont le guide est en anglais, utilise l'adresse de votre site Jira, l'adresse courriel de votre compte et votre jeton API pour s'y authentifier. Il lit l'identifiant du compte pour valider la connexion, ainsi que les données des issues, comme les identifiants des projets et des issues, les titres, les descriptions, les personnes assignées, les estimations, les états et les priorités.

Les issues importées sont conservées dans votre espace de travail local. Les changements d'estimation, d'état et de priorité que vous demandez sont transmis au site Jira. Les commentaires restent dans Jira avec le plugin actuel. Retirer la connexion arrête ses requêtes, sans supprimer les issues ni les changements déjà enregistrés dans Jira.

### Adresse de calendrier ICS

Le [plugin d'adresse de calendrier ICS](/plugins/ics), dont le guide est en anglais, lit l'adresse privée du calendrier que vous fournissez. Une adresse courriel facultative lui permet de reconnaître vos réponses aux invitations. L'adresse du calendrier est un identifiant secret. Le plugin télécharge le calendrier directement depuis son hôte, comme Google Calendar, Outlook ou Exchange. Le calendrier peut contenir des descriptions, des lieux, des liens de réunion et les coordonnées d'autres personnes, en plus des titres et des heures, même si Ajour n'utilise pas tous ces champs.

Seuls les champs des suggestions parviennent à Ajour : les identifiants des événements et des séries récurrentes, le titre, le début et la fin, le caractère journée entière, l'état, votre réponse, le caractère occupé ou libre et le fait que vous organisiez l'événement. Les événements récupérés restent en mémoire. Les entrées de temps, les réunions mémorisées et les décisions par occurrence que vous créez sont enregistrées localement. Le plugin n'écrit pas dans le calendrier. Retirer sa connexion ne révoque pas l'adresse privée. Réinitialisez cette adresse ou retirez sa publication chez le fournisseur pour qu'elle cesse de fonctionner.

### Agent Workday

Le [plugin d'agent Workday](/plugins/workday-agent), dont le guide est en anglais, utilise l'adresse de votre feuille de temps Workday, un nom d'utilisateur facultatif, les noms et les codes des projets et des tâches, ainsi que les dates, les durées, les notes et les identifiants des changements de temps de la semaine. Il donne à l'agent accès aux pages Workday nécessaires pour saisir et vérifier ces changements. L'agent transmet ce qu'il lit au fournisseur d'IA que vous avez configuré et envoie les changements de feuille de temps demandés à Workday.

La tâche ne passe pas par un service d'IA exploité par Ajour. Votre fournisseur d'IA et le service Workday de votre employeur contrôlent leurs copies. Le navigateur des agents peut garder les témoins et les sessions Workday entre les tâches. Votre propre navigateur peut donner accès à d'autres sites connectés dans ce profil. La section de l'application ci-dessus et le guide [Your data](/app/data), en anglais, expliquent le stockage et la suppression des données du navigateur. Terminer une tâche ou retirer ce plugin ne révoque pas une session Workday et n'efface pas les données déjà envoyées à Workday ou à un fournisseur d'IA.

### Team sync

Le plugin Team sync, maintenu dans un dépôt privé, utilise un serveur Convex choisi par votre équipe. Il traite l'adresse du déploiement, le nom et l'identifiant de l'équipe, son secret et, lorsque la création d'une équipe l'exige, une clé de création. Il transmet les champs des projets partagés, comme les noms, les codes, les couleurs, les icônes et l'état, ainsi que les noms des tâches, leur état, leur caractère facturable et leurs budgets. Le contrat de synchronisation ne transmet pas les entrées de temps, leurs notes ni le temps suivi.

Le serveur conserve les données partagées et une empreinte du secret d'équipe. Il reçoit toutefois le secret lui-même lorsqu'il valide une connexion ou une requête de synchronisation. Toute personne qui possède l'identifiant et le secret de l'équipe peut accéder aux données partagées. Se déconnecter ou arrêter le partage laisse la copie du serveur en place. La synchronisation permet l'archivage plutôt que la suppression des données. Consultez l'exploitant du serveur pour la suppression et la conservation. Cette politique ne propose pas de service d'équipe Ajour hébergé publiquement.

## Ce site Web

Le site de documentation est hébergé sur GitHub Pages et diffusé par Cloudflare. Ces fournisseurs traitent des renseignements techniques, comme les adresses IP, les pages demandées, l'heure des requêtes et les en-têtes du navigateur, pour diffuser et protéger le site. Leur infrastructure peut traiter les données hors du Québec ou du Canada.

Nous n'ajoutons au site ni traceurs publicitaires ni outils d'analyse de son utilisation. Le site peut mémoriser localement des préférences d'interface, comme le thème de couleurs. Les fournisseurs d'hébergement et de sécurité peuvent utiliser leurs propres témoins nécessaires ou des mécanismes semblables. Leurs politiques décrivent le traitement et la conservation des données techniques : [GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) et [Cloudflare](https://www.cloudflare.com/privacypolicy/).

Lorsque vous suivez un lien externe, les pratiques de confidentialité du service de destination s'appliquent.

## Lorsque vous nous contactez

Si vous nous écrivez ou ouvrez un ticket GitHub, nous recevons les renseignements que vous choisissez d'envoyer, par exemple votre nom, votre adresse courriel, votre message et ses pièces jointes. Nous les utilisons pour vous répondre, examiner le problème signalé ou traiter votre demande concernant vos renseignements personnels. N'envoyez pas d'identifiants ni de fichiers confidentiels de votre espace de travail. Les tickets GitHub sont publics. Retirez les renseignements personnels et confidentiels avant de les publier.

Les fournisseurs de courriel et GitHub traitent ces communications et peuvent les conserver hors du Québec ou du Canada. Nous conservons la correspondance seulement pendant la durée nécessaire au traitement de la demande, aux suivis associés et aux obligations légales, puis la supprimons lorsqu'elle n'est plus nécessaire. Les échanges publics sur GitHub suivent les règles de conservation et de retrait de GitHub. Nous pouvons communiquer les renseignements que nous détenons lorsque la loi l'exige ou le permet pour traiter un incident de sécurité.

## Vos choix et vos droits

Vous pouvez utiliser le suivi du temps local sans plugin ni agent. Vous pouvez désactiver des plugins, retirer des connexions, arrêter une tâche d'agent, révoquer un client MCP et supprimer les données locales. Protégez ou supprimez séparément vos exports et vos sauvegardes. La suppression des fichiers locaux ne révoque pas un identifiant chez son fournisseur et n'efface pas une copie déjà envoyée à un autre service.

Pour les renseignements personnels que nous détenons, écrivez à [info@cabochons.io](mailto:info@cabochons.io) pour demander l'accès, la rectification, la suppression ou une copie dans un format portable lorsque la loi applicable vous accorde ces droits. Vous pouvez aussi retirer un consentement lorsque le traitement en dépend, sous réserve des limites légales. Nous pouvons demander les renseignements nécessaires pour vérifier votre identité. Nous ne pouvons pas récupérer ou supprimer un espace de travail qui existe seulement sur votre appareil, ni agir au nom d'un fournisseur indépendant.

Vous pouvez envoyer une plainte à la même adresse. Au Québec, vous pouvez aussi vous adresser à la [Commission d'accès à l'information](https://www.cai.gouv.qc.ca/protection-renseignements-personnels/citoyens-protection-renseignements-personnels/acces-et-protection-renseignements-personnels).

## Modifications de cette politique

Nous publierons les modifications ici et mettrons à jour la date ci-dessus. Une modification importante sera accompagnée d'un avis sur cette page qui explique le changement. La mise à jour de la politique n'autorise pas à elle seule un nouvel usage de vos renseignements lorsqu'un consentement est nécessaire. Les versions antérieures restent accessibles dans l'historique du dépôt.

21 octobre 2026 : Précisions sur les données du compte et du calendrier Google, leurs usages, leurs destinataires, leur protection, leur durée de conservation et leur suppression. La connexion Google reste en développement.

21 octobre 2026 : Séparation du traitement propre à l'application et des informations concernant les plugins que nous maintenons. Ajout des données traitées par les plugins Azure DevOps, GitHub, Jira, ICS, l'agent Workday et Team sync.

</div>
