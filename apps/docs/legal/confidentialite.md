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

Dernière mise à jour : 20 octobre 2026

<a href="/legal/privacy" lang="en">English version</a> · [Conditions d'utilisation](/legal/conditions)

## Qui est responsable

Ajour est publié par Alex Trépanier, qui exerce ses activités sous le nom cabochons.io. Dans cette politique, "nous" désigne Alex Trépanier. Alex Trépanier est aussi le responsable de la protection des renseignements personnels. Vous pouvez lui écrire à [info@cabochons.io](mailto:info@cabochons.io) pour toute question, demande ou plainte concernant vos renseignements personnels.

Cette politique couvre l'application Ajour, son site de documentation et les renseignements que vous nous transmettez. Ajour est un outil de suivi du temps qui conserve d'abord les données sur votre appareil. Aucun compte Ajour n'est nécessaire. Nous n'exploitons pas de service qui reçoit votre espace de travail pour le conserver ou le sauvegarder. L'application ne nous envoie pas de télémétrie d'utilisation ni de rapports de plantage automatiques.

## Votre espace de travail local

Ajour conserve sur votre appareil les projets, les tâches, les entrées de temps, les notes, les éléments du backlog, le contenu importé, les paramètres et les connexions des plugins. Les renseignements lus dans un service connecté peuvent comprendre des descriptions, des commentaires ainsi que le nom ou les coordonnées de personnes. Ajour récupère les événements de calendrier pour les afficher, sans constituer d'archive du calendrier. Un événement que vous ajoutez comme entrée de temps fait alors partie de votre espace de travail.

Ces données servent aux fonctions que vous utilisez. Le fonctionnement local habituel ne nous les transmet pas. Nous ne vendons pas de renseignements personnels, ne les utilisons pas à des fins publicitaires et ne créons pas de profils de votre activité pour nos propres fins.

Le guide [Your data](/app/data), en anglais, précise où se trouvent les données et comment les sauvegarder ou les supprimer. Votre système d'exploitation, vos outils de sauvegarde ou l'administrateur de votre appareil peuvent aussi avoir accès aux fichiers locaux.

## Identifiants et accès des plugins

Dans la version actuelle, les jetons de connexion et les autres champs secrets sont conservés sans chiffrement dans le fichier local `app-api-state.json`. Ajour restreint les permissions de ce fichier, masque les champs secrets dans les paramètres et retire les secrets de connexion connus des erreurs et des résumés des plugins. Ces mesures réduisent les divulgations accidentelles. Elles n'isolent pas les identifiants du code des plugins installés ni des autres programmes qui s'exécutent sous votre compte utilisateur.

Ajour transmet actuellement à un plugin les identifiants de sa connexion. Le code du plugin s'exécute avec les permissions de votre compte utilisateur, peut lire les fichiers locaux et peut faire des requêtes réseau. Il ne s'exécute pas dans un bac à sable. Installez des plugins auxquels vous faites confiance, donnez à chaque jeton le moins de permissions possible et protégez le dossier de données ainsi que ses sauvegardes.

Nous sommes responsables de la manière dont Ajour traite les identifiants. Le courtier d'identifiants prévu gardera les secrets hors du code des plugins, les conservera localement avec le chiffrement du système d'exploitation et fera les requêtes authentifiées autorisées pour les plugins. Des bacs à sable distincts sont aussi prévus. Ces protections ne sont pas encore disponibles et ne constituent pas des garanties sur la version actuelle. Même avec un courtier, un plugin pourrait faire un mauvais usage des données ou des actions auxquelles vous lui donnez accès.

## Requêtes réseau et services connectés

Ajour utilise le réseau dans les cas suivants :

| Fonction                                | Renseignements et destinataire                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mises à jour de l'application           | L'application de bureau contacte GitHub au démarrage, environ toutes les quatre heures pendant qu'elle est ouverte et à votre demande. Les requêtes portent sur les versions publiées, y compris le canal de mise à jour et la version installée lorsque nécessaire. Le téléchargement attend votre confirmation. |
| Catalogue et téléchargement des plugins | Ajour contacte GitHub pour le catalogue, ses images et les versions publiées. Par défaut, le catalogue s'actualise au lancement et toutes les 15 minutes. Le téléchargement d'un plugin contacte GitHub et ses hôtes de téléchargement.                                                                           |
| Outils connectés                        | Un plugin envoie les requêtes, les identifiants et les données nécessaires à ses opérations au service que vous configurez, comme Azure DevOps, Jira, GitHub ou un calendrier. La lecture et l'écriture peuvent avoir lieu lors d'une synchronisation programmée ou de l'utilisation d'une fonction.              |
| Projets partagés                        | Un plugin d'équipe transmet les champs des projets et des tâches partagés au serveur choisi par votre équipe. Le contrat de synchronisation d'Ajour ne transmet pas les entrées de temps ni leurs notes. L'exploitant du serveur contrôle sa copie et sa durée de conservation.                                   |
| Agents                                  | Un client ou une tâche d'agent peut lire les données de l'espace de travail et le contenu du navigateur, puis les envoyer au fournisseur d'IA que vous avez configuré. Une tâche peut aussi saisir des données dans un service comme Workday.                                                                     |

Chaque service contacté reçoit les renseignements ordinaires d'une connexion, dont votre adresse IP et les métadonnées de la requête. Les requêtes de mise à jour et de catalogue ne contiennent pas vos entrées de temps ni vos jetons de connexion. Chaque fournisseur traite les requêtes selon ses propres politiques. GitHub explique ses pratiques dans sa [déclaration de confidentialité](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

Connecter un service, permettre à un agent de lire des données ou exporter un fichier peut communiquer des renseignements hors de votre appareil. Vérifiez les règles de votre organisation avant de partager des renseignements professionnels ou ceux d'autres personnes. Les données envoyées à un outil source, à un serveur d'équipe ou à un fournisseur d'IA peuvent y rester après le retrait de la connexion dans Ajour. Les conditions, les règles de conservation et les outils de suppression de ces services s'appliquent à leurs copies. Cette politique ne propose pas de service d'équipe hébergé par Ajour.

## Sessions du navigateur des agents

MCP et l'exécution de tâches d'agent sont facultatifs. Un agent peut transmettre à son fournisseur les renseignements qu'il lit, dont les entrées de temps, les notes, le contenu des éléments de travail et les pages visitées. L'utilisation de ces fonctions d'Ajour ne nous transmet pas ces renseignements.

En mode navigateur séparé, Ajour conserve un profil local entre les tâches. Ce profil peut garder des témoins, aussi appelés cookies, et des sessions ouvertes, dont une session Workday. Si vous reliez un agent à votre propre navigateur, celui-ci conserve ses propres données de session. Terminer une tâche ne ferme pas les sessions. Le guide [Your data](/app/data#back-up-export-or-delete-data), en anglais, explique comment les effacer localement.

## Connexion Google et Microsoft prévue

La prise en charge des connexions Google et Microsoft par le courtier d'identifiants n'est pas disponible dans la version actuelle. Cette section décrit le traitement prévu lorsque cette fonction sera disponible. Elle ne décrit pas la sécurité des plugins à jetons actuels.

Si vous vous connectez à un compte Google ou Microsoft avec cette fonction, Ajour gardera les identifiants du compte chiffrés sur votre appareil, sans nous les envoyer ni les transmettre au code des plugins. Il demandera le minimum de permissions pour les fonctions que vous choisissez. Les renseignements d'identité serviront seulement à distinguer les comptes lorsque nécessaire. L'accès au calendrier sera demandé à son activation. Les plugins autorisés utiliseront le compte par l'intermédiaire du courtier.

L'utilisation et le transfert par Ajour des renseignements reçus des API Google respecteront la [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), y compris ses exigences d'utilisation limitée, appelées Limited Use. Les données Google serviront uniquement aux fonctions visibles que vous activez. Elles ne seront ni vendues, ni utilisées à des fins publicitaires, ni utilisées pour entraîner des modèles d'IA à usage général. Tout transfert permis restera soumis à cette politique et au consentement qu'elle exige.

La version qui ajoutera ces connexions mettra cette politique à jour et expliquera les permissions, le retrait d'un compte et la révocation auprès du fournisseur. Supprimer un identifiant local et révoquer une permission chez un fournisseur sont deux actions différentes.

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

</div>
