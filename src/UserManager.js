// Copyright (c) Brock Allen & Dominick Baier. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE in the project root for license information.

import Log from './Log';
import OidcClient from './OidcClient';
import UserManagerSettings from './UserManagerSettings';
import User from './User';
import UserManagerEvents from './UserManagerEvents';
import SilentRenewService from './SilentRenewService';

export default class UserManager extends OidcClient {
    constructor(settings = {}) {
        
        if (!(settings instanceof UserManagerSettings)) {
            settings = new UserManagerSettings(settings);
        }
        super(settings);

        this._events = new UserManagerEvents(settings);

        if (this.settings.automaticSilentRenew) {
            Log.info("automaticSilentRenew is configured, setting up silent renew")
            this._silentRenewService = new SilentRenewService(this);
        }
    }

    get _redirectNavigator() {
        return this.settings.redirectNavigator;
    }
    get _popupNavigator() {
        return this.settings.popupNavigator;
    }
    get _iframeNavigator() {
        return this.settings.iframeNavigator;
    }
    get _userStore() {
        return this.settings.userStore;
    }

    get events() {
        return this._events;
    }

    getUser() {
        Log.info("UserManager.getUser");

        return this._loadUser().then(user => {
            if (user) {
                Log.info("user loaded");
                return user;
            }
            else {
                Log.info("user not found in storage");
                return null;
            }
        });
    }

    removeUser() {
        Log.info("UserManager.removeUser");

        return this._storeUser(null).then(() => {
            Log.info("user removed from storage");

            this._events.unload();
        });
    }

    signinPopup(args = {}) {
        Log.info("UserManager.signinPopup");

        let url = args.redirect_uri || this.settings.popup_redirect_uri || this.settings.redirect_uri;
        if (!url) {
            Log.error("No popup_redirect_uri or redirect_uri configured");
            return Promise.reject(new Error("No popup_redirect_uri or redirect_uri configured"));
        }

        args.redirect_uri = url;
        args.display = "popup";

        return this._signin(args, this._popupNavigator, {
            startUrl: url,
            popupWindowFeatures: args.popupWindowFeatures || this.settings.popupWindowFeatures,
            popupWindowTarget: args.popupWindowTarget || this.settings.popupWindowTarget
        });
    }
    signinPopupCallback(url) {
        Log.info("UserManager.signinPopupCallback");
        return this._signinCallback(url, this._popupNavigator);
    }

    signinSilent(args = {}) {
        Log.info("UserManager.signinSilent");

        let url = args.redirect_uri || this.settings.silent_redirect_uri;
        if (!url) {
            Log.error("No silent_redirect_uri configured");
            return Promise.reject(new Error("No silent_redirect_uri configured"));
        }

        args.redirect_uri = url;
        args.prompt = "none";

        return this._signin(args, this._iframeNavigator);
    }
    signinSilentCallback(url) {
        Log.info("UserManager.signinSilentCallback");
        return this._signinCallback(url, this._iframeNavigator);
    }

    _signin(args, navigator, navigatorParams = {}) {
        Log.info("_signin");
        return this._signinStart(args, navigator, navigatorParams).then(navResponse => {
            return this._signinEnd(navResponse.url);
        });
    }
    _signinCallback(url, navigator) {
        Log.info("_signinCallback");
        return navigator.callback(url);
    }
    _signout(args, navigator, navigatorParams = {}) {
        Log.info("_signout");
        return this._signoutStart(args, navigator, navigatorParams).then(navResponse => {
            return this._signoutEnd(navResponse.url);
        });
    }
    _signoutCallback(url, navigator) {
        Log.info("_signoutCallback");
        return navigator.callback(url);
    }

    signinRedirect(args) {
        Log.info("UserManager.signinRedirect");
        return this._signinStart(args, this._redirectNavigator);
    }
    signinRedirectCallback(url) {
        Log.info("UserManager.signinRedirectCallback");
        return this._signinEnd(url || this._redirectNavigator.url);
    }
    signoutRedirect(args) {
        Log.info("UserManager.signoutRedirect");
        return this._signoutStart(args, this._redirectNavigator);
    }
    signoutRedirectCallback(url) {
        Log.info("UserManager.signoutRedirectCallback");
        return this._signoutEnd(url || this._redirectNavigator.url);
    }

    _signinStart(args, navigator, navigatorParams = {}) {
        Log.info("_signinStart");

        return navigator.prepare(navigatorParams).then(handle => {
            Log.info("got navigator window handle");

            return this.createSigninRequest(args).then(signinRequest => {
                Log.info("got signin request");

                navigatorParams.url = signinRequest.url;
                return handle.navigate(navigatorParams);
            });
        });
    }
    _signinEnd(url) {
        Log.info("_signinEnd");

        return this.processSigninResponse(url).then(signinResponse => {
            Log.info("got signin response");

            let user = new User(signinResponse);

            return this._storeUser(user).then(() => {
                Log.info("user stored");

                this._events.load(user);

                return user;
            });
        });
    }

    _signoutStart(args = {}, navigator, navigatorParams = {}) {
        Log.info("_signoutStart");

        return navigator.prepare(navigatorParams).then(handle => {
            Log.info("got navigator window handle");

            return this.getUser().then(user => {
                Log.info("loaded current user from storage");

                var id_token = args.id_token_hint || user && user.id_token;
                if (id_token) {
                    Log.info("Setting id_token into signout request");
                    args.id_token_hint = id_token;
                }

                return this.removeUser().then(() => {
                    Log.info("user removed, creating signout request");

                    return this.createSignoutRequest(args).then(signoutRequest => {
                        Log.info("got signout request");

                        navigatorParams.url = signoutRequest.url;
                        return handle.navigate(navigatorParams);
                    });
                });
            });
        });
    }
    _signoutEnd(url) {
        Log.info("_signoutEnd");

        return this.processSignoutResponse(url).then(signoutResponse => {
            Log.info("got signout response");

            return signoutResponse;
        });
    }

    get _userStoreKey() {
        return `user:${this.settings.authority}:${this.settings.client_id}`;
    }

    _loadUser() {
        Log.info("_loadUser");

        return this._userStore.get(this._userStoreKey).then(storageString => {
            if (storageString) {
                Log.info("user storageString loaded");
                return User.fromStorageString(storageString);
            }

            Log.info("no user storageString");
            return null;
        });
    }

    _storeUser(user) {
        if (user) {
            Log.info("_storeUser storing user");

            var storageString = user.toStorageString();
            return this._userStore.set(this._userStoreKey, storageString);
        }
        else {
            Log.info("_storeUser removing user storage");
            return this._userStore.remove(this._userStoreKey);
        }
    }
}
